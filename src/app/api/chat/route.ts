import { NextRequest } from 'next/server';
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
// Fusion JSON types
interface FusionImageRef { doc: number; img: number; caption?: string; citeIndex?: number }
interface FusionSectionIn { heading?: string; text_markdown?: string; imageRefs?: FusionImageRef[] }
interface FusionJson { language?: string; sections?: FusionSectionIn[] }
interface ResolvedImage { src: string; alt: string; caption: string; citeIndex: number }
interface ResolvedSection { heading: string; markdown: string; images: ResolvedImage[] }
interface DocImage { idx: number; src: string; alt: string }
interface DocForPrompt { idx: number; title: string; url: string; text: string; images: DocImage[] }

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

function isGreeting(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(salut|bonjour|bonsoir|hello|hi|hey|yo)\b/.test(t);
}

function isCapabilityAsk(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /que\s+peux[- ]tu\s+faire/.test(t) ||
    /comment\s+peux[- ]tu\s+m[' ]?aider/.test(t) ||
    /qu['’]est-ce\s+que\s+tu\s+peux\s+faire/.test(t) ||
    /peux[- ]tu\s+m[' ]?aider/.test(t) ||
    /what\s+can\s+you\s+do/.test(t) ||
    /how\s+can\s+you\s+help/.test(t) ||
    /what\s+can\s+you\s+help\s+me\s+with/.test(t) ||
    /capabilit(y|ies)/.test(t)
  );
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

function proxyUrl(u: string): string {
  try {
    if (!u) return u;
    if (u.startsWith('/api/image?url=')) return u;
    if (/^data:/i.test(u)) return u;
    const enc = encodeURIComponent(u);
    return `/api/image?url=${enc}`;
  } catch { return u; }
}

function proxyHtmlImages(html: string): string {
  if (!html) return html;
  return html.replace(/<img([^>]*?)src=(['"])(.*?)(\2)([^>]*?)>/gi, (m, pre, q, src, _q2, post) => {
    try {
      if (!src || src.startsWith('/api/image?url=') || /^data:/i.test(src)) return m;
      const prox = proxyUrl(src);
      return `<img${pre}src=${q}${prox}${q}${post}>`;
    } catch { return m; }
  });
}

// Helpers to robustly parse model-returned JSON
function extractJsonCandidate(s: string): string {
  // Prefer fenced ```json blocks if present
  const fencedJson = s.match(/```\s*json\s*([\s\S]*?)```/i);
  if (fencedJson && fencedJson[1]) return fencedJson[1].trim();
  const fenced = s.match(/```\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  // Fallback: slice between first { and last }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);
  return s.trim();
}

function normalizeBackslashesForJson(s: string): string {
  // Escape stray backslashes that are not valid JSON escapes
  // Allowed escapes: " \\ \/ \b \f \n \r \t \u
  return s.replace(/\\(?!["\\\/bfnrtu])/g, '\\\\');
}

// Modify POST handler to incorporate summarize branch
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const primaryModel = process.env.OPENROUTER_MODEL_PRIMARY || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    const summaryModel = process.env.OPENROUTER_MODEL_SUMMARY || primaryModel;
    const fusionModel = process.env.OPENROUTER_MODEL_FUSION;
    const maxArticles = parseInt(process.env.SPACE_BIO_MAX_ARTICLES || '20', 10);
    const fuseArticlesMax = parseInt(process.env.SPACE_BIO_FUSE_MAX || '8', 10);
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
    const wantsSummary = !!body.summarize;

    // Intent routing
    const greet = isGreeting(userText);
    const capability = isCapabilityAsk(userText);
    const spaceBio = isSpaceBiologyQuery(userText);
    console.log('INTENT', { greet, capability, spaceBio });

    if (greet && !spaceBio && !capability) {
      const md = `👋 Salut ! Comment puis-je t'aider aujourd'hui ?\n\n- **Discuter** d'un sujet.\n- **Demander** ce que je peux faire.\n- **Poser** une question sur la biologie spatiale.`;
      return new Response(JSON.stringify({ mode: 'chitchat', markdown: md }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (capability) {
      if (spaceBio) {
        // Light-weight selection only; do not scrape/fuse yet
        let articles = await getArticles();
        if (articles.length) {
          const tokens = englishQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          const scored = articles.map(a => {
            const at = a.title.toLowerCase();
            const score = tokens.reduce((acc, t) => acc + (at.includes(t) ? 1 : 0), 0);
            return { article: a, score };
          }).sort((a,b) => b.score - a.score).slice(0, 10).map(s => s.article);
          articles = scored.length ? scored : articles.slice(0, 10);
        }
        const sources = articles.map((a, i) => `- [${i+1}] [${a.title}](${a.link})`).join('\n');
        const md = `### Ce que je peux faire (biologie spatiale)\n\n- **Trouver** et **sélectionner** des articles pertinents selon ta requête.\n- **Extraire** le contenu principal et les **figures utiles**.\n- **Fusionner** plusieurs sources en un \n  rendu structuré (Introduction, Résultats, Conclusion) avec **citations [n]** et **images** pertinentes.\n- **Résumer** rapidement des ensembles d'articles.\n- **Comparer** des résultats via **tableaux Markdown** ou décrire des **graphes** simples.\n\nDis-moi si tu veux que je **fasse une fusion**, un **résumé**, ou une **comparaison**.\n\n### Sources potentielles\n${sources || '- (aucune source trouvée pour le moment)'}`;
        return new Response(JSON.stringify({ mode: 'capabilities', markdown: md, articles }), { headers: { 'Content-Type': 'application/json' } });
      } else {
        const md = `### Ce que je peux faire\n\n- **Répondre** aux questions générales.\n- **Analyser** des requêtes en biologie spatiale.\n- **Sélectionner** des articles pertinents et **extraire** le contenu et les figures.\n- **Fusionner** plusieurs sources en un rendu Markdown structuré (Introduction, Résultats, Conclusion), avec **images pertinentes** et **citations [n]**, puis lister les **Sources**.\n- **Résumer** rapidement plusieurs articles.\n- **Comparer** des résultats via **tableaux Markdown** ou décrire des **graphes** simples.\n\nDis-moi ton besoin (ex: “analyse en microgravité ?”), et j'adapterai la démarche.`;
        return new Response(JSON.stringify({ mode: 'capabilities', markdown: md }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

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
        // If no summary requested, FUSE articles via LLM into Intro/Résultats/Conclusion with images as JSON
        if (!wantsSummary) {
          const fuseTargets = relatedArticles.slice(0, fuseArticlesMax);
          // Get text+images for fusion
          const scrapedForFusion = await batchScrape(fuseTargets);
          const docsForPrompt: DocForPrompt[] = scrapedForFusion.map((s, i) => ({
            idx: i + 1,
            title: s.title,
            url: s.link,
            text: (s.text || '').slice(0, 4000),
            images: (s.images || []).slice(0, 6).map((img, j) => ({ idx: j, src: img.src, alt: img.alt || '' }))
          }));
          console.log('FUSION_DOCS', docsForPrompt.map(d => ({ idx: d.idx, title: d.title, url: d.url, textLen: d.text.length, imageCount: d.images.length })));

          if (fusionModel) {
            const fusionPrompt = `Return ONLY strict JSON (UTF-8, no markdown, no code fences) with this schema:\n{\n  "language": "fr",\n  "sections": [\n    {"heading": "Introduction", "text_markdown": "...", "imageRefs": [{"doc": 1, "img": 0, "caption": "...", "citeIndex": 1}]},\n    {"heading": "Résultats", "text_markdown": "...", "imageRefs": []},\n    {"heading": "Conclusion", "text_markdown": "...", "imageRefs": []}\n  ]\n}\nGuidelines:\n- Write in the user's language; if unsure, prefer French.\n- Use the user's query for context and produce explicit, precise text (avoid generic filler).\n- Use only the provided documents and images by their indices.\n- For each section, include 0–3 imageRefs that DIRECTLY support the claims in that section; prefer figures whose captions/keywords match the text.\n- Add inline citations [n] in text_markdown when referencing specific claims.\n- In captions, append the citation [n] where n is the source index.\n- Never invent images or URLs; reference images only by {doc, img}.\n- text_markdown must be GitHub-Flavored Markdown (GFM).\n- Do NOT wrap the output in code fences.\n- Avoid stray backslashes; only valid JSON escape sequences (\\", \\\\, \\/, \\b, \\f, \\n, \\r, \\t, \\u) are permitted.\n- Use Markdown tables when helpful to compare findings/methods. If a simple graph would help, include a concise ASCII sketch or describe it in text.`;

            const fusionResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3000',
                'X-Title': process.env.OPENROUTER_TITLE || 'neil-engine',
              },
              body: JSON.stringify({
                model: fusionModel,
                temperature: 0.2,
                messages: [
                  { role: 'system', content: 'You merge multiple scientific documents into a single structured answer. Follow the JSON schema exactly.' },
                  { role: 'user', content: fusionPrompt },
                  { role: 'user', content: JSON.stringify({ queryOriginal: userText, queryEnglish: englishQuery, sources: docsForPrompt.map(d => ({ idx: d.idx, title: d.title, url: d.url })), documents: docsForPrompt }).slice(0, 60000) }
                ],
              }),
            });

            if (fusionResp.ok) {
              const fusionData: OpenRouterResponse = await fusionResp.json();
              const fusedRaw = fusionData.choices?.[0]?.message?.content || '';
              console.log('FUSION_RAW_SAMPLE', fusedRaw.slice(0, 500));
              try {
                const candidate = extractJsonCandidate(fusedRaw);
                let fusedObj: FusionJson | null = null;
                try {
                  fusedObj = JSON.parse(candidate);
                } catch {
                  const normalized = normalizeBackslashesForJson(candidate);
                  console.log('FUSION_JSON_NORMALIZED_APPLIED');
                  try {
                    fusedObj = JSON.parse(normalized);
                  } catch (e2) {
                    console.log('FUSION_JSON_PARSE_ERROR', (e2 as Error).message, { sample: normalized.slice(0, 400) });
                  }
                }
                if (!fusedObj) {
                  // Parsing failed; skip to fallback
                  throw new Error('fusion_json_unparsed');
                }
                const sectionsIn: FusionSectionIn[] = Array.isArray(fusedObj.sections) ? (fusedObj.sections as FusionSectionIn[]) : [];
                function tok(s: string) { return (s || '').toLowerCase().split(/[^a-z0-9éèêàùçäëïöüâôî]+/).filter(Boolean); }
                const resolved: ResolvedSection[] = sectionsIn.map((sec: FusionSectionIn) => {
                  const secTokens = new Set(tok(String(sec.text_markdown || '') + ' ' + englishQuery));
                  const withScores = (sec.imageRefs || []).map((ref: FusionImageRef) => {
                    const d = docsForPrompt.find(dd => dd.idx === ref.doc);
                    const im = d?.images?.find((ii) => ii.idx === ref.img);
                    if (!im) return null;
                    const imgTokens = new Set(tok((im.alt || '') + ' ' + (ref.caption || '') + ' ' + (d?.title || '')));
                    let overlap = 0; imgTokens.forEach(t => { if (secTokens.has(t)) overlap++; });
                    return { overlap, data: { src: im.src, alt: im.alt || '', caption: (ref.caption || ''), citeIndex: ref.citeIndex || ref.doc } };
                  }).filter(Boolean) as { overlap: number, data: { src: string, alt: string, caption: string, citeIndex: number } }[];
                  // Keep only with overlap > 0; if none, keep at most first 1
                  let filtered = withScores.filter(x => x.overlap > 0).sort((a,b) => b.overlap - a.overlap).slice(0,3);
                  if (filtered.length === 0 && withScores.length) filtered = withScores.slice(0,1);
                  const images = filtered.map(f => ({ ...f.data, src: proxyUrl(f.data.src) }));
                  console.log('FUSION_FILTER', { heading: sec.heading, total: (sec.imageRefs||[]).length, kept: images.length });
                  return { heading: sec.heading || '', markdown: sec.text_markdown || '', images };
                });
                console.log('FUSION_RESOLVED', resolved.map((s) => ({ heading: s.heading, mdLen: (s.markdown||'').length, imgCount: s.images.length })));
                if (resolved.length) {
                  return new Response(
                    JSON.stringify({ mode: 'fused_json', fusion: { sections: resolved }, articles: fuseTargets }),
                    { headers: { 'Content-Type': 'application/json' } }
                  );
                }
              } catch (e) {
                console.log('FUSION_JSON_PARSE_ERROR', (e as Error).message);
              }
            } else {
              const errTxt = await fusionResp.text();
              console.log('FUSION_UPSTREAM_ERROR', errTxt.slice(0, 400));
            }
          } else {
            console.log('FUSION_SKIP', 'OPENROUTER_MODEL_FUSION not set');
          }

          // If fusion failed or empty, extract and return structured HTML from each article
          const sections = await batchScrapeHtml(relatedArticles, { perArticleNodeLimit: 60, perArticleFigureLimit: 8 });
          if (sections.length) {
            const combinedHtml = sections.map(({ article, html }, idx) => (
              `<section class="scraped-article" style="margin:1rem 0;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.08)">`+
              `<h2 style="font-size:1rem;font-weight:600;margin-bottom:0.5rem">[${idx+1}] ${article.title} — <a href="${article.link}" target="_blank" rel="noopener nofollow noreferrer" style="color:#60a5fa;text-decoration:underline">source</a></h2>`+
              proxyHtmlImages(html)+
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
                const cap = img.caption ? `<figcaption style=\"font-size:0.8em;opacity:0.8\">${escapeHtml(img.caption)}</figcaption>` : '';
                return `<figure style=\"margin:0.75rem 0\"><img src=\"${proxyUrl(img.src)}\" alt=\"${alt}\" style=\"max-width:100%;height:auto;display:block;margin:0.25rem 0\"/>${cap}</figure>`;
              }).join('\n');
              const body = [paras, figs].filter(Boolean).join('\n');
              if (!body.trim()) return '';
              return (
                `<section class=\"scraped-article\" style=\"margin:1rem 0;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.08)\">`+
                `<h2 style=\"font-size:1rem;font-weight:600;margin-bottom:0.5rem\">[${idx+1}] ${escapeHtml(s.title)} — <a href=\"${s.link}\" target=\"_blank\" rel=\"noopener nofollow noreferrer\" style=\"color:#60a5fa;text-decoration:underline\">source</a></h2>`+
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