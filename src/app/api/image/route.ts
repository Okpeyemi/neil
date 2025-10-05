import { NextRequest } from 'next/server';

export const runtime = 'edge';

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (h.endsWith('.local')) return true;
  // IPv4 checks
  if (/^(127\.)/.test(h)) return true;
  if (/^(10\.)/.test(h)) return true;
  if (/^(192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

function swapScheme(u: string): string | null {
  try {
    const url = new URL(u);
    if (url.protocol === 'http:') { url.protocol = 'https:'; return url.toString(); }
    if (url.protocol === 'https:') { url.protocol = 'http:'; return url.toString(); }
    return null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('url') || '';
    if (!raw || !isHttpUrl(raw)) {
      return new Response('Bad Request: missing or invalid url', { status: 400 });
    }
    const target = new URL(raw);
    if (isPrivateHost(target.hostname)) {
      return new Response('Forbidden host', { status: 403 });
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; neil-image-proxy/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      // Some hosts require a referrer matching origin
      'Referer': `${target.origin}/`,
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };

    const tries: string[] = [target.toString()];
    const swapped = swapScheme(target.toString());
    if (swapped) tries.push(swapped);

    let resp: Response | null = null;
    for (const u of tries) {
      try {
        const r = await fetchWithTimeout(u, { headers, redirect: 'follow', cache: 'no-store' }, 12000);
        if (r.ok && r.body) { resp = r; break; }
      } catch { /* try next */ }
    }

    if (!resp || !resp.ok || !resp.body) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="14">Image non disponible</text></svg>`;
      return new Response(svg, { status: 200, headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300' } });
    }

    const contentType = resp.headers.get('content-type') || 'image/*';
    const headersOut = new Headers();
    headersOut.set('Content-Type', contentType);
    headersOut.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600');
    // Disallow downstream caching of error statuses
    headersOut.set('X-Source-Status', String(resp.status));

    return new Response(resp.body, { status: 200, headers: headersOut });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return new Response('Proxy error: ' + msg, { status: 502 });
  }
}
