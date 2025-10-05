import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

export const runtime = 'nodejs';

interface CsvRow { Title: string; Link: string }

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function readCsv(file: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    if (!fs.existsSync(file)) return resolve(rows);
    fs.createReadStream(file)
      .pipe(csv())
      .on('data', (data: Record<string, unknown>) => {
        const Title = String(data['Title'] ?? '').trim();
        const Link = String(data['Link'] ?? '').trim();
        if (Title && Link) rows.push({ Title, Link });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

export async function GET() {
  try {
    const csvPath = path.join(process.cwd(), 'public', 'SB_publication_PMC.csv');
    const rows = await readCsv(csvPath);
    const picks = pickRandom(rows, 3).map(r => ({ title: r.Title, link: r.Link }));
    return new Response(JSON.stringify({ suggestions: picks }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (_e: unknown) {
    return new Response(JSON.stringify({ suggestions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}
