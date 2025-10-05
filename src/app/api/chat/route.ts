import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

type ChatMode = 'Discovery' | 'Scientific' | 'Investor' | 'Architect';
type ChatRole = 'user' | 'assistant';
interface ChatMessage { role: ChatRole; content: string }
interface ArticleSection { heading: string; content: string }
interface ArticleImage { src: string; alt?: string; caption?: string }
interface ArticleRow {
  id: string;
  title: string;
  source_url: string;
  abstract?: string | null;
  sections?: ArticleSection[] | null;
  images?: ArticleImage[] | null;
}

function modeStyle(mode: ChatMode): string {
  switch (mode) {
    case 'Scientific':
      return 'Focused on methods, data, citations';
    case 'Investor':
      return 'Focused on market, ROI, risks, roadmap';
    case 'Architect':
      return 'Focused on architecture, integration, constraints';
    case 'Discovery':
    default:
      return 'General and balanced response';
  }
}

function isNasaRelated(q: string): boolean {
  const t = q.toLowerCase();
  const keywords = [
    'nasa',
    'space',
    'microgravity',
    'iss',
    'spaceflight',
    'astronaut',
    'pmc',
    'pubmed central',
    'space biology',
    'bion',
  ];
  return keywords.some((k) => t.includes(k));
}

function extractKeywords(q: string, max = 6): string[] {
  const words = (q.toLowerCase().match(/[a-z0-9]{4,}/g) || []).slice(0, 20);
  return Array.from(new Set(words)).slice(0, max);
}

function buildContext(
  docs: ArticleRow[],
  maxChars = 2800
): { text: string; sources: Array<{ id: string; title: string; url: string }>; images: Array<{ src: string; alt?: string; caption?: string }> } {
  const parts: string[] = [];
  const sources: Array<{ id: string; title: string; url: string }> = [];
  const images: Array<{ src: string; alt?: string; caption?: string }> = [];
  for (const d of docs) {
    const title = d.title as string;
    const url = d.source_url as string;
    const abstract = (d.abstract as string | null) || '';
    const sections = (d.sections as ArticleSection[] | null) || [];
    const imgs = (d.images as ArticleImage[] | null) || [];
    const sectionSnippets = sections
      .slice(0, 2)
      .map((s) => `- ${s.heading}: ${s.content?.slice(0, 500)}`)
      .join('\n');
    parts.push(
      [
        `TITLE: ${title}`,
        `URL: ${url}`,
        abstract ? `ABSTRACT: ${abstract.slice(0, 600)}` : '',
        sectionSnippets ? `SECTIONS:\n${sectionSnippets}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
    sources.push({ id: d.id as string, title, url });
    for (const im of imgs) if (im?.src) images.push({ src: im.src, alt: im.alt, caption: im.caption });
    if (parts.join('\n\n').length >= maxChars) break;
  }
  const text = parts.join('\n\n');
  return { text, sources, images };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const { question, mode: modeRaw, history: historyRaw } = (body ?? {}) as {
      question?: string;
      mode?: ChatMode;
      history?: unknown;
    };
    if (typeof question !== 'string' || !question.trim()) {
      return new Response(JSON.stringify({ error: 'Invalid question' }), { status: 400 });
    }
    const mode: ChatMode = (modeRaw as ChatMode) || 'Discovery';
    const isChatMessage = (m: unknown): m is ChatMessage =>
      !!m && typeof m === 'object' &&
      ('role' in (m as Record<string, unknown>)) &&
      ((m as Record<string, unknown>).role === 'user' || (m as Record<string, unknown>).role === 'assistant') &&
      typeof (m as Record<string, unknown>).content === 'string';
    const history: ChatMessage[] = Array.isArray(historyRaw)
      ? (historyRaw as unknown[]).filter(isChatMessage).slice(-10)
      : [];

    const nasa = isNasaRelated(question);
    const client = new OpenAI({
      apiKey: process.env.OPEN_ROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });

    if (!nasa) {
      // General chat without Supabase context — stream tokens
      const system = `Tu es un assistant utile et concis. Réponds en français. Utilise le markdown quand pertinent. ${modeStyle(mode)}`;
      const encoder = new TextEncoder();
      const stream = await client.chat.completions.create({
        model: 'openai/gpt-oss-20b',
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          ...history.map((m) => ({ role: m.role, content: m.content } as const)),
          { role: 'user', content: question },
        ],
        stream: true,
      });
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                const delta = chunk.choices?.[0]?.delta?.content || '';
                if (delta) controller.enqueue(encoder.encode(delta));
              }
            } catch (err) {
              controller.error(err);
              return;
            }
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    // NASA-related: fetch context from Supabase
    const supabase = getSupabase();
    const terms = extractKeywords(question);
    let qb = supabase
      .from('articles')
      .select('id,title,source_url,abstract,sections,images')
      .limit(5);
    if (terms.length) {
      const ors: string[] = [];
      for (const t of terms) {
        const pat = `*${t}*`;
        ors.push(`title.ilike.${pat}`);
        ors.push(`abstract.ilike.${pat}`);
      }
      qb = qb.or(ors.join(','));
    } else {
      qb = qb.order('scraped_at', { ascending: false });
    }
    const { data: docs, error } = await qb;
    if (error) {
      console.warn('[chat] Supabase query error:', error.message);
    }
    const { text: context, sources, images } = buildContext(docs || []);

    const system =
      `Tu es un assistant qui répond STRICTEMENT en te basant sur le contexte fourni (articles NASA/PMC). Si l’information manque, dis-le clairement. Réponds en français. Utilise le markdown. ${modeStyle(mode)}\n\nFormate ta réponse en sections: \n### Introduction\n### Résumé\n### Conclusion\n### Sources (liens)\n### Figures (si disponibles)`;
    const user = `Question: ${question}\n\nContexte:\n${context || '(Aucun contexte trouvé)'}\n\nConsigne: Structure la réponse comme indiqué et reste précis.`;

    const encoder = new TextEncoder();
    const stream = await client.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role, content: m.content } as const)),
        { role: 'user', content: user },
      ],
      stream: true,
    });
    const srcMd = sources.length
      ? `\n\n### Sources\n${sources.map((s) => `- [${s.title}](${s.url})`).join('\n')}`
      : '';
    const figsMd = images && images.length
      ? `\n\n### Figures\n${images.slice(0, 6).map((im) => `![${im.alt || 'figure'}](${im.src})${im.caption ? `\n<small>${im.caption}</small>` : ''}`).join('\n\n')}`
      : '';
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const delta = chunk.choices?.[0]?.delta?.content || '';
              if (delta) controller.enqueue(encoder.encode(delta));
            }
            if (srcMd) controller.enqueue(encoder.encode(srcMd));
            if (figsMd) controller.enqueue(encoder.encode(figsMd));
          } catch (err) {
            controller.error(err);
            return;
          }
          controller.close();
        },
      }),
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  } catch (e: unknown) {
    console.error('[chat] error', e);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
}
