import { NextRequest } from 'next/server';
import { batchScrape, Article } from '@/lib/scrape';

export const runtime = 'edge';

interface ScrapeRequestBody { articles: Article[] }

export async function POST(req: NextRequest) {
  try {
    const body: ScrapeRequestBody = await req.json();
    if (!body.articles || !Array.isArray(body.articles) || body.articles.length === 0) {
      return new Response(JSON.stringify({ error: 'articles array required' }), { status: 400 });
    }
    // Basic sanitization
    const cleaned: Article[] = body.articles.slice(0, 12).map(a => ({
      title: String(a.title || '').slice(0, 500),
      link: String(a.link || '').slice(0, 2000)
    })).filter(a => a.title && a.link.startsWith('http'));
    if (!cleaned.length) {
      return new Response(JSON.stringify({ error: 'no valid articles (need http links)' }), { status: 400 });
    }
    const scraped = await batchScrape(cleaned);
    return new Response(JSON.stringify({ articles: scraped }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown';
    return new Response(JSON.stringify({ error: 'Server error', details: message }), { status: 500 });
  }
}
