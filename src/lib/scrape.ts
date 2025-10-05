import { parse, HTMLElement } from 'node-html-parser';

export interface Article { title: string; link: string }
export interface ScrapedImage { src: string; alt?: string; caption?: string }
export interface ScrapedArticle extends Article { text: string; images: ScrapedImage[] }

export interface ScrapeHtmlOptions {
  perArticleNodeLimit?: number;
  perArticleFigureLimit?: number;
}

// Limits / tuning
const MAX_MAIN_TEXT_CHARS = 20_000;
const MAX_IMAGES = 18;
const SCRAPE_TTL = 1000 * 60 * 10; // 10 min cache

function absolutize(url: string, base: string): string {
  try { return new URL(url, base).toString(); } catch { return url; }
}

async function scrapeArticle(url: string): Promise<{ text: string; images: ScrapedImage[] }> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7',
        'Referer': `${new URL(url).origin}/`
      }
    });
    if (!res.ok) return { text: '', images: [] };
    const html = await res.text();
    const root = parse(html);
    let mainEl = root.querySelector('main') as HTMLElement | null;
    if (!mainEl) {
      const articleEl = root.querySelector('article') as HTMLElement | null;
      if (articleEl) mainEl = articleEl; else mainEl = (root.querySelector('body') as HTMLElement | null) || (root as unknown as HTMLElement);
    }
    mainEl.querySelectorAll('script,style,nav,header,footer,aside').forEach((n: HTMLElement) => n.remove());
    const text = mainEl.textContent.trim().replace(/\s+/g, ' ').slice(0, MAX_MAIN_TEXT_CHARS);
    const figures: ScrapedImage[] = [];

    function parseSrcset(ss?: string | null): string | null {
      if (!ss) return null;
      // pick the first URL in srcset
      const first = ss.split(',')[0]?.trim();
      if (!first) return null;
      const urlOnly = first.split(' ')[0]?.trim();
      return urlOnly || null;
    }

    function findFigureImageUrl(fig: HTMLElement): { src: string; alt?: string } | null {
      // Try <img> or <amp-img>
      const img = (fig.querySelector('img') as HTMLElement | null) || (fig.querySelector('amp-img') as HTMLElement | null);
      let raw: string | null = null;
      let alt: string | undefined = undefined;
      if (img) {
        raw = img.getAttribute('src')
          || img.getAttribute('data-src')
          || img.getAttribute('data-original')
          || img.getAttribute('data-lazy-src')
          || null;
        if (!raw) {
          raw = parseSrcset(img.getAttribute('srcset'))
            || parseSrcset(img.getAttribute('data-srcset'))
            || null;
        }
        alt = img.getAttribute('alt') || undefined;
      }
      // If still nothing, try <picture><source srcset>
      if (!raw) {
        const srcEl = fig.querySelector('source') as HTMLElement | null;
        const sset = srcEl?.getAttribute('srcset') || srcEl?.getAttribute('data-srcset') || null;
        raw = parseSrcset(sset);
      }
      // As a last resort, try <a href> to a likely image file
      if (!raw) {
        const a = fig.querySelector('a') as HTMLElement | null;
        const href = a?.getAttribute('href') || '';
        if (/\.(png|jpe?g|webp|gif|bmp|tiff?)($|\?)/i.test(href)) raw = href;
      }
      if (!raw) return null;
      const abs = absolutize(raw, url);
      return { src: abs, alt };
    }

    mainEl.querySelectorAll('figure').slice(0, MAX_IMAGES).forEach((fig: HTMLElement) => {
      const found = findFigureImageUrl(fig);
      if (!found) return;
      const capEl = fig.querySelector('figcaption') as HTMLElement | null;
      let caption: string | undefined = undefined;
      if (capEl) caption = capEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 400) || undefined;
      // Fallback alt from caption if missing
      const altFinal = found.alt || (caption ? caption.slice(0, 120) : undefined);
      figures.push({ src: found.src, alt: altFinal, caption });
    });
    // Capture standalone images not wrapped in <figure>
    if (figures.length < MAX_IMAGES) {
      const imgs = mainEl.querySelectorAll('img');
      const used = new Set(figures.map(f => f.src));
      for (const img of imgs) {
        try {
          // skip if inside a figure by walking up the tree
          type NodeLike = { parentNode?: NodeLike | null; tagName?: string };
          let p: NodeLike | null = (img as unknown as NodeLike).parentNode ?? null;
          let insideFigure = false;
          // eslint-disable-next-line no-constant-condition
          while (p) {
            const tag = (p.tagName || '').toLowerCase();
            if (tag === 'figure') { insideFigure = true; break; }
            p = p.parentNode ?? null;
          }
          if (insideFigure) continue;
          let raw = (img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original')) || '';
          if (!raw) {
            raw = parseSrcset(img.getAttribute('srcset')) || parseSrcset(img.getAttribute('data-srcset')) || '';
          }
          if (!raw) continue;
          const abs = absolutize(raw, url);
          if (used.has(abs)) continue;
          const alt = img.getAttribute('alt') || undefined;
          figures.push({ src: abs, alt, caption: undefined });
          used.add(abs);
          if (figures.length >= MAX_IMAGES) break;
        } catch { /* ignore */ }
      }
    }
    console.log('SCRAPE_RESULT', { url, textLen: text.length, figures: figures.length, first: figures[0]?.src || null });
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

// --- HTML scraping (sanitized structured content) ---

function pickMainContainer(root: HTMLElement): HTMLElement {
  const selectors = [
    'article',
    'main',
    '[role="main"]',
    '#content',
    '#main-content',
    '.post-content',
    '.entry-content',
    '[itemprop="articleBody"]',
    '.content',
  ];
  for (const sel of selectors) {
    const found = root.querySelector(sel) as HTMLElement | null;
    if (found) return found;
  }
  return root;
}

function normalizeLinksAndImages(container: HTMLElement, baseUrl: string, figureLimit: number) {
  container.querySelectorAll('a').forEach((aEl: HTMLElement) => {
    const href = aEl.getAttribute('href');
    if (href) aEl.setAttribute('href', absolutize(href, baseUrl));
    aEl.setAttribute('target', '_blank');
    aEl.setAttribute('rel', 'noopener nofollow noreferrer');
    const attrs = aEl.attributes || {} as Record<string,string>;
    Object.keys(attrs).forEach(k => {
      if (k.toLowerCase().startsWith('on')) aEl.removeAttribute(k);
    });
  });
  
  const figures = container.querySelectorAll('figure');
  figures.forEach((fig: HTMLElement, idx: number) => {
    if (idx >= figureLimit) {
      fig.remove();
      return;
    }
    try { fig.setAttribute('style', 'margin:0.75rem 0;'); } catch {}
    fig.querySelectorAll('img').forEach((img: HTMLElement) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
      if (src) img.setAttribute('src', absolutize(src, baseUrl));
      ['srcset','sizes','integrity','crossorigin','referrerpolicy','style','onload','onclick','onerror'].forEach(attr => img.removeAttribute(attr));
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      const alt = img.getAttribute('alt') || '';
      img.setAttribute('alt', alt);
      try { img.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0.25rem 0;'); } catch {}
    });
  });

  // Normalize standalone images not wrapped in <figure>
  container.querySelectorAll('img').forEach((img: HTMLElement) => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
    if (src) img.setAttribute('src', absolutize(src, baseUrl));
    ['srcset','sizes','integrity','crossorigin','referrerpolicy','style','onload','onclick','onerror'].forEach(attr => img.removeAttribute(attr));
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    const alt = img.getAttribute('alt') || '';
    img.setAttribute('alt', alt);
    try { img.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0.25rem 0;'); } catch {}
  });
}

function extractAllowedHtml(container: HTMLElement, perArticleNodeLimit: number): string {
  const keepSelectors = 'h1,h2,h3,h4,p,ul,ol,blockquote,pre,figure,img,table';
  const nodes = container.querySelectorAll(keepSelectors);
  const limited = nodes.slice(0, perArticleNodeLimit);
  limited.forEach((node: HTMLElement) => {
    node.querySelectorAll('script,style,meta,link,iframe,object,embed,noscript').forEach((bad: HTMLElement) => bad.remove());
    node.querySelectorAll('*').forEach((el: HTMLElement) => {
      const attrKeys = Object.keys((el.attributes || {}) as Record<string,string>);
      for (const k of attrKeys) {
        if (k.toLowerCase().startsWith('on')) el.removeAttribute(k);
      }
      const tag = (el.tagName || '').toLowerCase();
      if (tag !== 'img' && tag !== 'figure') {
        try { el.removeAttribute('style'); } catch {}
      }
    });
  });
  return limited.map((n: HTMLElement) => n.toString()).join('\n');
}

const htmlCache = new Map<string, { ts: number; html: string }>();

export async function scrapeArticleHtml(url: string, opts?: ScrapeHtmlOptions): Promise<string> {
  const perArticleNodeLimit = opts?.perArticleNodeLimit ?? 60;
  const perArticleFigureLimit = opts?.perArticleFigureLimit ?? 8;
  const now = Date.now();
  const cached = htmlCache.get(url);
  if (cached && (now - cached.ts) < SCRAPE_TTL) return cached.html;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7'
      }
    });
    if (!res.ok) return '';
    const html = await res.text();
    const root = parse(html);
    const main = pickMainContainer(root as unknown as HTMLElement);
    normalizeLinksAndImages(main, url, perArticleFigureLimit);
    const contentHtml = extractAllowedHtml(main, perArticleNodeLimit);
    if (contentHtml && contentHtml.trim()) {
      htmlCache.set(url, { ts: now, html: contentHtml });
    }
    return contentHtml;
  } catch {
    return '';
  }
}

export async function batchScrapeHtml(articles: Article[], opts?: ScrapeHtmlOptions): Promise<{ article: Article; html: string }[]> {
  const sections = await Promise.all(articles.map(async (a) => {
    const html = await scrapeArticleHtml(a.link, opts);
    return { article: a, html };
  }));
  // Keep only non-empty html
  return sections.filter(s => s.html && s.html.trim());
}
