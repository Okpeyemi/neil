export interface ArticleSection {
  heading: string;
  content: string;
}

export interface ArticleDocument {
  id: string; // slug or hash
  title: string;
  sourceUrl: string;
  abstract?: string;
  sections: ArticleSection[];
  rawHtmlLength?: number;
  scrapedAt: string; // ISO date
  errors?: string[];
}

export interface ScrapeResultSummary {
  total: number;
  succeeded: number;
  failed: number;
  failures: { url: string; error: string }[];
  outputDir: string;
  durationSeconds: number;
}
