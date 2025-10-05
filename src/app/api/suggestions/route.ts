import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CsvRow { Title: string; Link: string }

const GITHUB_CSV_URL = process.env.SUGGESTIONS_CSV_URL
  || 'https://raw.githubusercontent.com/jgalazka/SB_publications/main/SB_publication_PMC.csv';

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// Parsing minimal: gère titres potentiellement entre guillemets, ignore lignes invalides
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return [];
  // supprimer header s'il contient Title,Link
  if (/title\s*,\s*link/i.test(lines[0])) lines.shift();
  const rows: CsvRow[] = [];
  for (const l of lines) {
    // Cas: "Titre, avec virgule",https://...
    const mQuoted = l.match(/^"(.*)",(https?:\/\/.+)$/);
    if (mQuoted) {
      const Title = mQuoted[1].trim();
      const Link = mQuoted[2].trim();
      if (Title && Link) rows.push({ Title, Link });
      continue;
    }
    const mPlain = l.match(/^(.*?),(https?:\/\/.+)$/);
    if (mPlain) {
      const Title = mPlain[1].replace(/^"|"$/g, '').trim();
      const Link = mPlain[2].trim();
      if (Title && Link) rows.push({ Title, Link });
    }
  }
  return rows;
}

async function fetchGithubCsv(): Promise<CsvRow[]> {
  try {
    const res = await fetch(GITHUB_CSV_URL, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[suggestions] Échec fetch GitHub:', res.status, res.statusText);
      return [];
    }
    const text = await res.text();
    return parseCsv(text);
  } catch (e: unknown) {
    console.warn('[suggestions] Exception fetch GitHub:', (e as Error).message);
    return [];
  }
}

function readLocalCsvIfExists(): CsvRow[] {
  const localPath = path.join(process.cwd(), 'public', 'SB_publication_PMC.csv');
  if (!fs.existsSync(localPath)) return [];
  try {
    const text = fs.readFileSync(localPath, 'utf8');
    return parseCsv(text);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    console.debug('[suggestions] Chargement CSV GitHub:', GITHUB_CSV_URL);
    let rows = await fetchGithubCsv();

    if (!rows.length) {
      console.debug('[suggestions] Fallback lecture locale');
      rows = readLocalCsvIfExists();
    }

    if (!rows.length) {
      return new Response(JSON.stringify({ suggestions: [], error: 'CSV introuvable ou vide (GitHub + local)' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const picks = pickRandom(rows, Math.min(3, rows.length))
      .map(r => ({ title: r.Title, link: r.Link }));

    return new Response(JSON.stringify({ suggestions: picks }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    console.error('[suggestions] Erreur générale:', (e as Error).message);
    return new Response(JSON.stringify({ suggestions: [], error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
