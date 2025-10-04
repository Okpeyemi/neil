import { parse, HTMLElement } from 'node-html-parser';

export interface Article { title: string; link: string }
export interface ScrapedImage { src: string; alt?: string; caption?: string }
export interface ScrapedArticle extends Article { text: string; images: ScrapedImage[] }

// Limits / tuning
const MAX_MAIN_TEXT_CHARS = 20_000;
const MAX_IMAGES = 12;
const SCRAPE_TTL = 1000 * 60 * 30; // 30 min cache

function absolutize(url: string, base: string): string {
  try { return new URL(url, base).toString(); } catch { return url; }
}

async function scrapeArticle(url: string): Promise<{ text: string; images: ScrapedImage[] }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpaceBioBot/1.0)' } });
    if (!res.ok) return { text: '', images: [] };
    const html = await res.text();
    const root = parse(html);
    let mainEl = root.querySelector('main') as HTMLElement | null;
    if (!mainEl) {
      const articleEl = root.querySelector('article') as HTMLElement | null;
      if (articleEl) mainEl = articleEl; else mainEl = (root.querySelector('body') as HTMLElement | null) || (root as unknown as HTMLElement);
    }
    mainEl.querySelectorAll('script,style,nav,header,footer,aside').forEach((n: HTMLElement) => (n as any).remove());
    const text = mainEl.textContent.trim().replace(/\s+/g, ' ').slice(0, MAX_MAIN_TEXT_CHARS);
    const figures: ScrapedImage[] = [];
    mainEl.querySelectorAll('figure').slice(0, MAX_IMAGES).forEach((fig: HTMLElement) => {
      const img = fig.querySelector('img') as HTMLElement | null;
      if (!img) return;
      const srcRaw = img.getAttribute('src') || '';
      if (!srcRaw) return;
      const src = absolutize(srcRaw, url);
      const alt = img.getAttribute('alt') || undefined;
      let caption: string | undefined;
      const capEl = fig.querySelector('figcaption') as HTMLElement | null;
      if (capEl) caption = capEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 400) || undefined;
      figures.push({ src, alt, caption });
    });
    return { text, images: figures };
  } catch {
    return { text: '', images: [] };
  }
}

// In-memory cache (per serverless container / edge region)
const scrapedCache = new Map<string, { ts: number; data: { text: string; images: ScrapedImage[] } }>();

export async function getScraped(url: string) {
  const now = Date.now();
  const cached = scrapedCache.get(url);
  if (cached && (now - cached.ts) < SCRAPE_TTL) return cached.data;
  const data = await scrapeArticle(url);
  scrapedCache.set(url, { ts: now, data });
  return data;
}

export async function batchScrape(articles: Article[]): Promise<ScrapedArticle[]> {
  return Promise.all(articles.map(async a => {
    const { text, images } = await getScraped(a.link);
    return { ...a, text, images };
  }));
}
