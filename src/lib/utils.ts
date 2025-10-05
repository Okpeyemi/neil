import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || crypto.randomBytes(4).toString('hex');
}

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function writeJSON(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function hash(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

export function generateId(title: string, url: string) {
  return `${slugify(title)}-${hash(url)}`;
}

export async function fetchWithRetry(url: string, options: { attempts?: number; delayMs?: number; timeout?: number } = {}) {
  const { attempts = 3, delayMs = 1000, timeout = 30000 } = options;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await axios.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0 (NASA-RAG/1.0)' } });
      return res.data as string;
    } catch (e: unknown) {
      lastErr = e;
      if (i < attempts) await sleep(delayMs * i);
    }
  }
  throw lastErr;
}
