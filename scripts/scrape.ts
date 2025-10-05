#!/usr/bin/env tsx
/**
 * Phase 1 Scraper
 * Reads CSV (public/SB_publication_PMC.csv) expecting columns: Title, Link
 * Scrapes PMC article pages extracting: title, abstract, main sections.
 */
import fs from 'fs';
import path from 'path';
// @ts-ignore - types provided via @types/csv-parser dev dependency
import csv from 'csv-parser';
// @ts-ignore - axios types should resolve after install
import axios from 'axios';
// @ts-ignore - cheerio types installed transitively
import * as cheerio from 'cheerio';
import { ArticleDocument } from '../src/lib/types';
import { ensureDir, generateId, sleep, writeJSON } from '../src/lib/utils';

const CSV_PATH = process.env.CSV_PATH || path.join(process.cwd(), 'public', 'SB_publication_PMC.csv');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), 'data', 'articles');
const START_INDEX = parseInt(process.env.START_INDEX || '0', 10);
const MAX_ARTICLES = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const DELAY_MS = parseInt(process.env.DELAY_MS || '2500', 10); // polite delay
const RETRIES = parseInt(process.env.RETRIES || '3', 10);

interface CsvRow { Title: string; Link: string }

function readCsv(file: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const rows: CsvRow[] = [];
    fs.createReadStream(file)
      .pipe(csv())
  .on('data', (data: any) => {
        if (data.Title && data.Link) rows.push({ Title: data.Title, Link: data.Link });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function fetchHtml(url: string, attempt = 1): Promise<string> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NASA-RAG-Scraper/1.0; +https://example.com)'
      },
      timeout: 30000,
    });
    return res.data as string;
  } catch (err: any) {
    if (attempt < RETRIES) {
      const backoff = attempt * 1500;
      console.warn(`Retry ${attempt} for ${url} after ${backoff}ms`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

function extractArticle(url: string, html: string): Omit<ArticleDocument, 'scrapedAt' | 'id'> {
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || $('title').text().trim();
  const abstract = $('#abstract, .abstract').first().text().trim() || $('section:contains("Abstract")').first().text().trim();

  // Collect section headings (h2/h3) and their following paragraphs until next heading
  const sections: { heading: string; content: string }[] = [];
  const headingSelectors = 'h2, h3';
  $(headingSelectors).each((_: any, el: any) => {
    const heading = $(el).text().trim();
    if (!heading) return;
    const parts: string[] = [];
    let sibling = $(el).next();
    while (sibling.length && !sibling.is(headingSelectors)) {
      const tag = sibling.get(0)?.tagName?.toLowerCase();
      if (tag && ['p', 'div', 'section'].includes(tag)) {
        const text = sibling.text().trim();
        if (text) parts.push(text);
      }
      sibling = sibling.next();
    }
    if (parts.length) {
      sections.push({ heading, content: parts.join('\n\n') });
    }
  });

  // Fallback: if no sections extracted, grab main article body text
  if (!sections.length) {
    const bodyText = $('article').text().trim() || $('body').text().trim().slice(0, 15000);
    sections.push({ heading: 'FullText', content: bodyText });
  }

  return {
    title,
    sourceUrl: url,
    abstract: abstract || undefined,
    sections,
    rawHtmlLength: html.length,
  };
}

async function main() {
  const started = Date.now();
  ensureDir(OUTPUT_DIR);
  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV not found at', CSV_PATH);
    process.exit(1);
  }
  const rows = await readCsv(CSV_PATH);
  const slice = rows.slice(START_INDEX, MAX_ARTICLES ? START_INDEX + MAX_ARTICLES : undefined);
  console.log(`Total rows: ${rows.length}. Processing ${slice.length} starting at index ${START_INDEX}`);

  let succeeded = 0;
  const failures: { url: string; error: string }[] = [];

  for (let i = 0; i < slice.length; i++) {
    const { Title, Link } = slice[i];
    console.log(`[${i + 1}/${slice.length}] Fetching: ${Title} -> ${Link}`);
    try {
      const html = await fetchHtml(Link);
      const extracted = extractArticle(Link, html);
      const id = generateId(extracted.title || Title, Link);
      const doc: ArticleDocument = {
        id,
        ...extracted,
        scrapedAt: new Date().toISOString(),
      };
      const outFile = path.join(OUTPUT_DIR, `${id}.json`);
      writeJSON(outFile, doc);
      succeeded++;
    } catch (e: any) {
      console.error('Failed:', Link, e.message);
      failures.push({ url: Link, error: e.message });
    }
    await sleep(DELAY_MS);
  }

  const summary = {
    total: slice.length,
    succeeded,
    failed: failures.length,
    failures,
    outputDir: OUTPUT_DIR,
    durationSeconds: (Date.now() - started) / 1000,
  };
  const summaryPath = path.join(OUTPUT_DIR, `scrape-summary-${Date.now()}.json`);
  writeJSON(summaryPath, summary);
  console.log('Done. Summary written to', summaryPath);
  if (failures.length) {
    console.log('Failures:');
    for (const f of failures) console.log('-', f.url, f.error);
  }
}

main().catch((e) => {
  console.error('Fatal error', e);
  process.exit(1);
});
