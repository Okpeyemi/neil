import { NextRequest } from 'next/server';
import { parse } from 'node-html-parser'; // still used for CSV parsing (simple)
import { batchScrape, Article, ScrapedArticle } from '@/lib/scrape';

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

// Modify POST handler to incorporate summarize branch
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const primaryModel = process.env.OPENROUTER_MODEL_PRIMARY || process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    const summaryModel = process.env.OPENROUTER_MODEL_SUMMARY || primaryModel;
    const maxArticles = parseInt(process.env.SPACE_BIO_MAX_ARTICLES || '8', 10);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing OPENROUTER_API_KEY on server' }), { status: 500 });
    }

    const body: ChatRequestBody = await req.json();
    if (!body.messages || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array required' }), { status: 400 });
    }

    const userLast = body.messages[body.messages.length - 1];
    const userText = userLast?.content || '';

    let relatedArticles: Article[] = [];
    const augmentedMessages = body.messages.map(m => ({ role: m.role, content: m.content }));
    let articlesOnly = false;
    const wantsSummary = !!body.summarize;

    if (isSpaceBiologyQuery(userText)) {
      relatedArticles = await getArticles();
      if (relatedArticles.length) {
        const tokens = userText.toLowerCase().split(/[^a-z0-9éèêàùç]+/).filter(Boolean);
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
        articlesOnly = !wantsSummary; // if no summary requested, short-circuit
      }
    }

    // Early return if just listing articles (no scraping / summarization)
    if (articlesOnly) {
      return new Response(JSON.stringify({ mode: 'articles_only', reply: '', articles: relatedArticles }), { headers: { 'Content-Type': 'application/json' } });
    }

    // If summarize requested and we have related articles, scrape them
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