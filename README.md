## NASA Scientific Articles Chat (RAG + Web Search)

This project aims to build a Retrieval-Augmented Generation (RAG) chatbot over NASA / space biology related scientific articles (PubMed Central). It scrapes article HTML, stores structured JSON, (later) indexes embeddings into a vector database, and serves a chat UI that answers user questions using local context first, falling back to web search.

Demo: https://neil-eight.vercel.app/

---
## Roadmap (Phases)
1. Phase 1 (DONE):
	- CSV ingestion & scraper (`scripts/scrape.ts`)
	- JSON storage (`data/articles/*.json`)
	- Basic chat interface (echo reply)
	- API route stubs `/api/chat`, `/api/scrape`
2. Phase 2: Embeddings + Vector DB (Pinecone)
	- Generate embeddings per section using HuggingFace model (e.g. `sentence-transformers/all-MiniLM-L6-v2` via Inference API / local transformers.js)
	- Upsert vectors (id, text, metadata)
	- Semantic similarity search
3. Phase 3: Chatbot with Context
	- RAG pipeline: user question -> embed -> top-k retrieval -> prompt assembly -> OpenRouter model (`gpt-oss-20b`)
	- Streaming responses (optional)
	- Source citations (section headings + URLs)
4. Phase 4: Web Search Fallback + Tests
	- If similarity threshold not met, perform web search (SerpAPI / DuckDuckGo)
	- Merge result snippets into prompt
	- Jest unit tests (scraper utilities, ranking) + optional Cypress E2E

---
## Tech Stack
Framework: Next.js (App Router, TypeScript)
UI: Tailwind CSS (v4) – minimal custom components
Scraping: axios + cheerio + csv-parser
Future RAG: Pinecone vector DB + HuggingFace embeddings
LLM Access: OpenRouter (model: `gpt-oss-20b`)
Search Fallback: External web search API (configurable)

---
## Directory Overview
```
scripts/            Standalone Node/TS scripts (scrape.ts)
data/articles/      JSON article outputs (gitignored except .gitkeep)
src/lib/            Shared types & utilities
src/app/api/        API route handlers (chat, scrape trigger)
src/app/page.tsx    Chat UI (Phase 1)
public/             Static assets + source CSV
```

---
## Environment Variables
Copy `.env.example` to `.env.local` and fill in keys (only needed for future phases right now):
```
OPEN_ROUTER_API_KEY=sk-...
PINECONE_API_KEY=pc-...
PINECONE_ENV=us-east-1-gcp
PINECONE_INDEX_NAME=nasa-articles
SEARCH_API_KEY=your_search_key
CSV_PATH=public/SB_publication_PMC.csv
OUTPUT_DIR=data/articles
LIMIT=20            # optional limit for quick runs
DELAY_MS=2500       # polite delay between requests
RETRIES=3
```

---
## Install & Run (Phase 1)
1. Install deps:
```bash
npm install
```
2. Run scraper (will read CSV and save JSON docs):
```bash
npm run scrape
```
	Optional overrides:
```bash
LIMIT=10 DELAY_MS=3000 npm run scrape
```
3. Start dev server:
```bash
npm run dev
```
Open http://localhost:3000 – ask a question (echo response for now).

---
## Scraper Details
Input CSV columns: `Title`, `Link` (PMC article URLs). Example row:
```
"Gene Expression in Space-Biology",https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4136787/
```
Extraction steps:
1. Download HTML with polite User-Agent + delay + retries.
2. Parse with Cheerio.
3. Extract:
	- Title (`h1` or `<title>`)
	- Abstract (element with id/class containing `abstract`)
	- Sections: iterate h2/h3, capture following paragraphs until next heading.
	- Fallback single `FullText` section if structured headings missing.
4. Write JSON: `{ id, title, sourceUrl, abstract, sections[], scrapedAt }` to `data/articles/<id>.json`.

Rate limits: configurable delay via `DELAY_MS`. Retries with linear backoff.

---
## Planned RAG Pipeline (Phase 2–3)
1. Offline embedding generation script: iterate JSON docs, chunk (by section or token length), call embedding model, upsert to Pinecone.
2. Query flow:
	- User question -> embedding -> vector search (top 5) -> filter by similarity threshold (e.g. 0.7 cosine)
	- Construct prompt: system instructions + formatted context blocks + user question
	- Call OpenRouter (model: `gpt-oss-20b`) with safety guardrails
3. Response packaging: answer + list of source section headings + article URLs

---
## Web Search Fallback (Phase 4)
If no vector result above threshold:
1. Perform web search (SerpAPI / DuckDuckGo simple API)
2. Take top 3–5 results: title + snippet + URL
3. Append to prompt as secondary context (flagged as external web info)
4. Return answer with source grouping (local vs web)

---
## Testing Strategy
Planned (Phase 4):
* Unit tests (Jest):
  - utils: slugify, generateId, fetchWithRetry (mock axios)
  - section extraction (sample HTML fixtures)
* Integration: simulate question -> retrieval stub
* Optional E2E: Cypress run through chat UI

---
## Prompt Template (Draft)
```
You are an assistant answering questions strictly using the provided context from NASA / space biology scientific articles. If the answer is not present, say you will search the web (future). Cite section headings and article titles.

Context:
{{CONTEXT_BLOCKS}}

Question: {{USER_QUESTION}}
Answer in French, concise, with bullet points when listing.
```
---
## Notes & Compliance
* Scraper is polite: delay + custom UA
* Respect PMC usage terms; avoid extremely high concurrency
* Only storing textual content locally for research Q/A

---
## Next Steps
See roadmap phases above. Immediate next: implement embeddings + Pinecone integration script (`scripts/embed.ts`).

---
## License
MIT (add LICENSE file if distribution required)

## AI Usage & Methodology

This project is explicitly designed as an AI-assisted Retrieval-Augmented Generation (RAG) pipeline for space / NASA biology literature. Below is a transparent summary of how AI is (and will be) used.

### Current / Implemented
1. Assisted Development:
   - Code scaffolding (API routes, scraper structure, utility patterns)
   - Refactoring for streaming, dynamic route caching, error paths
   - Prompt template drafting (context‑first, citation emphasis)
2. Content Processing (Planned in Phase 2–3 but structurally prepared):
   - Text chunking by semantic section
   - Embedding generation (HuggingFace sentence-transformers model)
3. Retrieval Layer (Planned):
   - Vector similarity (Pinecone) → top‑k context assembly
4. Response Generation:
   - LLM (OpenRouter model gpt-oss-20b) constrained to supplied context
   - Citation packaging (title + section heading)
5. Guardrails (Initial Draft):
   - Refuse unsupported questions (out of scope / no context)
   - Encourage provenance (source list always returned)

### Primary User Use Cases
1. Rapid literature triage for spaceflight biology (bone loss, immune modulation, radiation response)
2. Cross-paper thematic linking (e.g., oxidative stress ↔ muscle atrophy ↔ microgravity models)
3. Hypothesis drafting (e.g., candidate pathways for countermeasures)
4. Educational Q/A (French / English concise summaries)
5. Countermeasure research support (identify recurring molecular targets)
6. Experimental design inspiration (highlight model organisms & assays)
7. Gap spotting (flag topics with sparse contextual matches → triggers web fallback)
8. Metadata enrichment (planned: entity tagging for pathways, genes, stressors)

### Planned AI Enhancements
| Area | Enhancement |
|------|-------------|
| Embeddings | Multi-model embedding ensemble (bio + general) for robustness |
| Retrieval | Hybrid (BM25 + vectors) + query classification (factual vs exploratory) |
| Post-processing | Answer confidence scoring (similarity dispersion + coverage ratio) |
| Evaluation | Precision@k, Coverage@k, Hallucination audit set |
| Summarization | Batch abstractive summaries per article / section |
| Entity Layer | Gene/protein / pathway tagging (BioNER) for structured filters |
| Caching | Deterministic cache key (hash(question) + top doc ids) to reduce cost |
| Web Fallback | Merge external snippets with explicit separation + lower weight |
| Safety | Simple rule filter for speculative biomedical claims without citation |

### Prompt Strategy (Draft Evolution)
1. System: scope limitation (PMC NASA / space biology)
2. Context blocks: sorted by descending similarity; truncated to token budget
3. Citation formatting: [Section Title | Article Title | URL]
4. Refusal policy: if no block above threshold (e.g. 0.68 cosine), return “insufficient internal context” (then web search Phase 4)
5. Style: concise, structured bullets for mechanistic / molecular queries

### Data & Compliance Notes
- Only open-access PubMed Central pages parsed.
- No model fine-tuning on proprietary sources.
- Embeddings store text fragments + minimal metadata (id, title, url, section).
- Removal / re-scrape pipeline possible (idempotent by article id).

### How AI Assisted This Repository (Meta)
| Task | AI Contribution | Human Oversight |
|------|-----------------|-----------------|
| Scraper architecture | Suggested modular retries + delay params | Adjusted selectors & pacing |
| Error handling | Proposed fallback strategies | Validated edge cases |
| README structuring | Generated initial outline | Curated, pruned scope claims |
| Prompt template | Draft system & context pattern | Refined citation format |
| Refactors | Simplified CSV ingestion path | Confirmed runtime constraints |

### Limitations
- No factual guarantee without proper evaluation suite yet.
- Embedding-based recall may miss niche mechanistic details (will improve with hybrid retrieval).
- Web fallback not active until Phase 4 → currently limited to local corpus.

### Opt-Out & Traceability (Planned)
- Per-article exclusion list
- Retrieval debug mode (`/api/chat?debug=1`) returning raw similarity scores

