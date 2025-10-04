import { NextRequest } from 'next/server';
import { parse } from 'node-html-parser'; // still used for CSV parsing (simple)
import { batchScrape, batchScrapeHtml, Article, ScrapedArticle } from '@/lib/scrape';

// Simple schema of request body
interface ChatRequestBody {
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  // When true, server will attempt to scrape & summarize related articles instead of just returning list
  summarize?: boolean;
}

interface OpenRouterChoiceMessage { role: string; content: string }
interface OpenRouterChoice { message?: OpenRouterChoiceMessage }
interface OpenRouterResponse { choices?: OpenRouterChoice[] }

// Article / Scraped types now imported

export const runtime = 'edge'; // faster cold start, streaming possible later

// Basic in-memory cache (edge note: resets on redeploy / region)
let cachedArticles: Article[] | null = null;
let lastFetch = 0;
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

const DEFAULT_CSV_URL = 'https://raw.githubusercontent.com/jgalazka/SB_publications/refs/heads/main/SB_publication_PMC.csv';

function isSpaceBiologyQuery(text: string): boolean {
  const lowered = text.toLowerCase();
  return [
    'space biology','biologie spatiale','microgravity','micro-gravity','microgravité','iss',
    'international space station','spatial biology','spaceflight','space flight','gravity biology',
    'zero g','0g','space bio','gravité','gravity','biologie de l\'espace','biology of space','space environment'
  ].some(k => lowered.includes(k));
}

function parseCsv(csv: string): Article[] {
  // Expect first row headers including title, link (or similar). We'll split by newline, simple CSV (no embedded commas assumption).
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const titleIdx = header.findIndex(h => h.startsWith('title'));
  const linkIdx = header.findIndex(h => ['link','url'].includes(h));
  if (titleIdx === -1 || linkIdx === -1) return [];
  const articles: Article[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= Math.max(titleIdx, linkIdx)) continue;
    const title = cols[titleIdx].trim();
    const link = cols[linkIdx].trim();
    if (title && link) articles.push({ title, link });
  }
  return articles;
}

async function getArticles(): Promise<Article[]> {
  const now = Date.now();
  if (cachedArticles && (now - lastFetch) < CACHE_TTL_MS) return cachedArticles;
  const url = process.env.SPACE_BIO_CSV_URL || DEFAULT_CSV_URL;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const text = await res.text();
  cachedArticles = parseCsv(text);
  lastFetch = now;
  return cachedArticles;
}

// Scrape helpers now centralized in lib

async function translateToEnglish(text: string, apiKey: string, model: string): Promise<string> {
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3000',
        'X-Title': process.env.OPENROUTER_TITLE || 'neil-engine',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Translate the user input to English. Return only the translation without quotes or extra text.' },
          { role: 'user', content: text }
        ],
      }),
    });
    if (!resp.ok) return text;
    const data: OpenRouterResponse = await resp.json();
    const out = data.choices?.[0]?.message?.content?.trim();
    return out && out.length ? out : text;
  } catch {
    return text;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Modify POST handler to incorporate summarize branch
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const primaryModel = process.env.OPENROUTER_MODEL_PRIMARY || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    const summaryModel = process.env.OPENROUTER_MODEL_SUMMARY || primaryModel;
    const maxArticles = parseInt(process.env.SPACE_BIO_MAX_ARTICLES || '20', 10);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing OPENROUTER_API_KEY on server' }), { status: 500 });
    }

    const body: ChatRequestBody = await req.json();
    if (!body.messages || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array required' }), { status: 400 });
    }

    const userLast = body.messages[body.messages.length - 1];
    const userText = userLast?.content || '';
    // Detection: translate to English for selection
    const englishQuery = await translateToEnglish(userText, apiKey, primaryModel);

    let relatedArticles: Article[] = [];
    const augmentedMessages = body.messages.map(m => ({ role: m.role, content: m.content }));
    let articlesOnly = false;
    const wantsSummary = !!body.summarize;

    if (isSpaceBiologyQuery(userText)) {
      relatedArticles = await getArticles();
      if (relatedArticles.length) {
        // Selection: score titles against translated English query and pick top N
        const tokens = englishQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const scored = relatedArticles.map(a => {
          const at = a.title.toLowerCase();
            const score = tokens.reduce((acc, t) => acc + (at.includes(t) ? 1 : 0), 0);
            return { article: a, score };
          }).filter(s => s.score > 0);
        const top = (scored.length ? scored : relatedArticles.map(a => ({ article: a, score: 0 })))
          .sort((a,b) => b.score - a.score)
          .slice(0, maxArticles)
          .map(s => s.article);
        relatedArticles = top;
        // If no summary requested, extract and return structured HTML from each article
        if (!wantsSummary) {
          const sections = await batchScrapeHtml(relatedArticles, { perArticleNodeLimit: 60, perArticleFigureLimit: 8 });
          if (sections.length) {
            const combinedHtml = sections.map(({ article, html }, idx) => (
              `<section class="scraped-article" style="margin:1rem 0;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.08)">`+
              `<h2 style="font-size:1rem;font-weight:600;margin-bottom:0.5rem">[${idx+1}] ${article.title} — <a href="${article.link}" target="_blank" rel="noopener nofollow noreferrer" style="color:#60a5fa;text-decoration:underline">source</a></h2>`+
              html+
              `</section>`
            )).join('\n');
            return new Response(JSON.stringify({ mode: 'scraped', reply: '', html: combinedHtml, articles: sections.map(s => s.article) }), { headers: { 'Content-Type': 'application/json' } });
          } else {
            // Fallback: build minimal per-article HTML from text + images
            const scrapedFallback = await batchScrape(relatedArticles);
            const built = scrapedFallback.map((s, idx) => {
              const paras = s.text
                ? escapeHtml(s.text).split(/\n{2,}|(?<=[.!?])\s{2,}/).slice(0, 12).map(p => `<p>${p.trim()}</p>`).join('\n')
                : '';
              const figs = (s.images || []).slice(0, 8).map(img => {
                const alt = img.alt ? escapeHtml(img.alt) : '';
                const cap = img.caption ? `<figcaption style="font-size:0.8em;opacity:0.8">${escapeHtml(img.caption)}</figcaption>` : '';
                return `<figure style="margin:0.75rem 0"><img src="${img.src}" alt="${alt}" style="max-width:100%;height:auto;display:block;margin:0.25rem 0"/>${cap}</figure>`;
              }).join('\n');
              const body = [paras, figs].filter(Boolean).join('\n');
              if (!body.trim()) return '';
              return (
                `<section class="scraped-article" style="margin:1rem 0;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.08)">`+
                `<h2 style="font-size:1rem;font-weight:600;margin-bottom:0.5rem">[${idx+1}] ${escapeHtml(s.title)} — <a href="${s.link}" target="_blank" rel="noopener nofollow noreferrer" style="color:#60a5fa;text-decoration:underline">source</a></h2>`+
                body+
                `</section>`
              );
            }).filter(Boolean).join('\n');
            if (built && built.trim()) {
              return new Response(JSON.stringify({ mode: 'scraped', reply: '', html: built, articles: scrapedFallback.map(a => ({ title: a.title, link: a.link })) }), { headers: { 'Content-Type': 'application/json' } });
            }
            // If still nothing, fallback list
            return new Response(JSON.stringify({ mode: 'articles_only', reply: '', articles: relatedArticles }), { headers: { 'Content-Type': 'application/json' } });
          }
        }
      }
    }

    // Early return listing is no longer used here; when scraping fails we return articles_only above.

    // If summarize requested and we have related articles, scrape (text) them for LLM summary
    let scraped: ScrapedArticle[] = [];
    if (wantsSummary && relatedArticles.length) {
      scraped = await batchScrape(relatedArticles);
    }

    // If we have scraped data, build a summary prompt
    if (wantsSummary && scraped.length) {
      const summaryPrompt = `You are an expert space biology analyst. Summarize the following articles. Provide:\n1. A consolidated overview (max 250 words)\n2. Key findings bullet list\n3. Notable methodologies\n4. Knowledge gaps / future directions.\n\nArticles JSON:\n${JSON.stringify(scraped.map(s => ({ title: s.title, url: s.link, text: s.text.slice(0, 4000) })), null, 2)}`.slice(0, 40_000);

      const summaryResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3000',
          'X-Title': process.env.OPENROUTER_TITLE || 'neil-engine',
        },
        body: JSON.stringify({
          model: summaryModel,
          messages: [
            { role: 'system', content: 'You create concise, structured scientific syntheses.' },
            { role: 'user', content: summaryPrompt }
          ],
          temperature: 0.4,
        }),
      });

      if (!summaryResp.ok) {
        const errTxt = await summaryResp.text();
        return new Response(JSON.stringify({ error: 'Summary upstream error', details: errTxt }), { status: 502 });
      }

      const summaryData: OpenRouterResponse = await summaryResp.json();
      const summary = summaryData.choices?.[0]?.message?.content || '';

      return new Response(JSON.stringify({ mode: 'articles_summary', summary, articles: scraped }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Fallback: normal primary chat completion
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3000',
        'X-Title': process.env.OPENROUTER_TITLE || 'neil-engine',
      },
      body: JSON.stringify({
        model: primaryModel,
        messages: augmentedMessages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      return new Response(JSON.stringify({ error: 'Upstream error', details: errTxt }), { status: 502 });
    }

    const data: OpenRouterResponse = await response.json();
    const assistantMessage = data.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({ reply: assistantMessage, articles: relatedArticles }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown';
    return new Response(JSON.stringify({ error: 'Server error', details: message }), { status: 500 });
  }
}