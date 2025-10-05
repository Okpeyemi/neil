# Neil – NASA Bioscience Intelligence Chat Interface

[![Production](https://img.shields.io/badge/Live_App-neil-eight.vercel.app-brightgreen?style=for-the-badge)](https://neil-eight.vercel.app/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwind-css)](https://tailwindcss.com/)
[![i18n](https://img.shields.io/badge/Internationalization-next--intl-8A2BE2)](https://next-intl-docs.vercel.app/)

> An AI-powered conversational interface to explore, query, and summarize NASA bioscience experiment publications (608+ studies) using natural language (text and voice).  
> Goal: Help scientists, mission planners, hypothesis generators, and decision makers rapidly surface insights, trends, knowledge gaps, and experiment outcomes relevant to future human exploration of the Moon and Mars.

---

## 1. Problem Context (Challenge Summary)

NASA has decades of bioscience experimentation data describing how humans, plants, microbes, and other biological systems respond to the space environment. While these publications are publicly available, discovering actionable insights (e.g., physiological adaptations, experimental results, risk factors, countermeasures) is difficult due to:

- Volume & fragmentation of studies
- Heterogeneous terminology
- Varied experiment conditions over time
- Differing levels of detail across sections (e.g., Results vs. Conclusions)

Emerging AI methods (LLMs, embeddings, summarization pipelines, knowledge graphs) make it possible to:
- Synthesize findings across experiments
- Identify gaps or consensus/disagreement
- Support hypothesis generation
- Provide mission-relevant insight pathways

---

## 2. Our Solution

Neil provides a focused conversational agent (chatbot) that:
- Accepts user queries as text or recorded audio
- Interprets intent and retrieves semantically related NASA bioscience publications
- Generates synthesized responses grounded in source documents
- Optionally returns structured highlights (e.g., experiment outcomes, organism focus, environment factors—future extension)
- Maintains conversational context across turns (multi-step refinement)
- (Planned) Allows drill-down into citation provenance and evidence strings

This first iteration prioritizes:
- Fast question → answer loop
- Extensibility for richer exploration (dashboards, knowledge graph views, temporal trend analysis)

---

## 3. Target User Profiles

| Audience | Needs | How Neil Helps |
|----------|-------|----------------|
| Scientists | Hypothesis refinement, compare past outcomes | Rapid summarization + targeted follow-up queries |
| Mission Architects | Risk identification, countermeasure tracking | Aggregated insights on biological system responses |
| Program Managers | Funding gap detection | Surface under-explored topics / missing data domains |
| Analysts | Synthesis & reporting | Structured summaries with (planned) traceability |

---

## 4. Core Functionalities (Current & Planned)

| Category | Current | Planned / Roadmap |
|----------|---------|-------------------|
| Text Q&A | ✅ Basic multi-turn | Context weighting & query rewriting |
| Audio Input | ✅ Recording → transcription | Streaming partial responses |
| Retrieval | ✅ Semantic similarity (embeddings; implementation detail abstracted) | Hybrid lexical + semantic + section weighting |
| Summarization | ✅ High-level answer generation | Section-aware (Intro vs. Results vs. Conclusion) |
| Provenance | ⚠ Partial (conceptual) | Inline citation anchors & explorable source panels |
| Knowledge Graph | ⏳ Not yet | Entity-relation extraction (organism → condition → outcome) |
| Gap Analysis | ⏳ Not yet | Trend detection + cluster visualizations |
| Multilingual UI | ⏳ Not yet | Domain-specific translation glossaries |
| UI Mode | ✅ Chat-centric | Dual: Chat + Analytical Dashboard |
| Security | Basic (public data) | Rate limiting & abuse detection |
| Exports | ⏳ Not yet | JSON / CSV for evidence sets |

---

## 5. High-Level Architecture (Conceptual)

```
User (Text / Audio)
        |
        v
(If Audio) Browser Recorder
        |
        v
Transcription Layer (Web Speech API or external ASR*)  *implementation-dependent
        |
        v
Query Normalization (lowercasing, domain term expansion*)
        |
        v
Embedding Generation (LLM / vector model*)
        |
        v
Vector Store / Semantic Index (NASA publication chunks)
        |
        v
Ranked Context Assembly (dedupe + section weighting)
        |
        v
LLM Answer Generation (with grounding instructions)
        |
        v
Response + (Planned) Citation / Source Panels
```

(* Some components are architectural intentions; actual implementation may evolve.)

---

## 6. Data Handling & Publication Ingestion (Design)

| Step | Description |
|------|-------------|
| Source Acquisition | Fetch / download metadata + full text (when available) from NASA bioscience listing |
| Cleaning | Strip boilerplate, normalize headings, section detection (Intro / Methods / Results / Conclusion) |
| Segmentation | Chunk documents using token-aware windowing; preserve experiment identifiers |
| Embedding | Generate vector embeddings per chunk (model TBD or pluggable) |
| Indexing | Store in vector DB (e.g., future: Pinecone / pgvector / open-source; current: abstract layer) |
| Refresh Cycle | Periodic rebuild or incremental upsert for new publications |
| Versioning | (Planned) Index manifest with hash + ingestion date |

---

## 7. Conversation & Context Strategy

- Turn-level memory: maintain last N exchanges (configurable)
- Context budgeting: choose top K chunks under model token limit
- Section prioritization (planned):
  - Results > Abstract > Conclusion > Introduction
- Guardrails (planned):
  - Refusal for out-of-domain queries
  - Hallucination reduction via answer template:
    - Direct answer
    - Supporting evidence
    - Limitations / uncertainty
    - Suggested follow-up query

---

## 8. Audio Query Flow

1. User clicks microphone
2. Recording starts (UI state: listening)
3. Audio → transcription
4. Transcript injected as user message
5. Same retrieval + generation path as text

Potential future additions:
- Language auto-detection
- Confidence scoring
- Noise filtering / VAD (voice activity detection)

---

## 9. Tech Stack (Current Codebase)

| Layer | Tool |
|-------|------|
| Framework | Next.js 15 (Turbopack) |
| Language | TypeScript |
| UI | React 19 |
| Styling | Tailwind CSS 4 |
| i18n | `next-intl` |
| Content Rendering | `react-markdown`, `remark-gfm` |
| HTML Parsing | `node-html-parser` |
| (Planned AI libs) | Embedding + LLM provider (e.g., OpenAI / Anthropic / Local) |
| Deployment | Vercel |

Note: AI- and vector-related libraries are intentionally decoupled; integration layer can be swapped without rewriting UI.

---

## 10. Project Structure (Indicative / Evolving)

```
app/
  [locale]/
    layout.tsx
    page.tsx
  api/
    chat/route.ts      # Chat request handler (planned or present)
    ingest/route.ts    # (Optional) secured ingestion trigger
components/
  chat/
    ChatInterface.tsx
    MessageBubble.tsx
    AudioRecorder.tsx
  ui/
    Button.tsx
    Spinner.tsx
lib/
  embeddings/
  retrieval/
  summarization/
  audio/
  i18n/
messages/
public/
types/
```

---

## 11. Getting Started

```bash
git clone https://github.com/Okpeyemi/neil.git
cd neil
npm install
npm run dev
# Open http://localhost:3000
```

---

## 12. Environment Variables (Proposed)

Create `.env.local`:

```
# Public base URL
NEXT_PUBLIC_SITE_URL=https://neil-eight.vercel.app/

# Default locale
NEXT_PUBLIC_DEFAULT_LOCALE=en

# AI Provider (example placeholders)
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=...

# Vector store config (future)
VECTOR_DB_URL=
VECTOR_DB_API_KEY=
```

---

## 13. Usage (MVP)

1. Open the app
2. Type a question like:
   - "What have NASA studies shown about plant root growth in microgravity?"
   - "Identify knowledge gaps in muscle atrophy countermeasures."
3. (Optional) Click microphone, ask verbally
4. Receive structured answer (summary + elaboration)
5. Refine: "Focus on cardiovascular findings" or "List 3 gaps."

(Planned) Click citations to expand original experiment summary.

---

## 14. Retrieval & Ranking Strategy (Planned Enhancements)

| Mechanism | Purpose |
|-----------|---------|
| Hybrid search | Combine semantic + keyword for precision |
| Section weighting | Boost 'Results' for empirical claims |
| Temporal filtering | Explore trends over mission eras |
| Entity extraction | Build organism-pathway-condition graph |
| Disagreement detection | Flag conflicting findings |

---

## 15. Performance & Optimization

- Incremental indexing vs. full rebuilds
- Token-aware context packing
- Caching frequent queries (edge cache layer)
- Streaming response (planned)
- Client-level suspense boundaries for partial hydration

---

## 16. Accessibility

- Keyboard-first interaction (tab focus)
- Visible focus rings
- ARIA live regions for streaming answer segments (planned)
- Transcript display for audio queries

---

## 17. Security & Ethical Considerations

| Concern | Mitigation |
|---------|------------|
| Hallucination | Grounding instructions + citations |
| Misinterpretation of experiment limitations | Include disclaimers |
| Sensitive biomedical overreach | Restrict speculative medical advice |
| Abuse (spam queries) | Rate limiting (future) |

---

## 18. Roadmap (Detailed)

| Phase | Focus | Examples |
|-------|-------|----------|
| 0.1 (Now) | Chat + base retrieval | Text + audio input |
| 0.2 | Citations + provenance | Collapsible evidence blocks |
| 0.3 | Knowledge graph prototype | Entity / relation extraction |
| 0.4 | Gap analysis views | Heatmaps, cluster timelines |
| 0.5 | Trend analytics | Time-series of experiment topics |
| 0.6 | Export & API | `/api/query`, JSON payload |
| 0.7 | Dashboard mode | Dual-pane: Chat + Visualization |
| 1.0 | Public beta | Stability, documentation, tests |

---

## 19. Testing (Planned)

| Test Type | Scope |
|-----------|-------|
| Unit | Parsing, chunking, ranker |
| Integration | Retrieval + answer synthesis |
| E2E | User query flows (text + audio) |
| Regression | Dataset changes vs. answer drift |
| Evaluation | BLEU/ROUGE / factuality heuristics (manual augmentation) |

---

## 20. Contribution Guidelines

1. Fork repo
2. Create a feature branch: `feat/<short-name>`
3. Follow Conventional Commits (`feat:`, `fix:`, `refactor:`…)
4. Add/update type definitions for new modules
5. Open PR with:
   - Description
   - Screenshots (if UI)
   - Notes on retrieval or model changes

---

## 21. Limitations (Current)

- No full provenance UI yet
- No public dataset ingestion pipeline exposed
- AI provider abstraction not published in repo (as of now)
- Knowledge graph features not implemented yet
- Audio pipeline depends on browser capabilities / external ASR

---

## 22. Future Extensions

- Multi-turn experiment comparison mode
- "Insight cards" summarizing clusters
- Mission scenario simulation queries (e.g., "Long-duration lunar impacts on X")
- Offline embeddings recalculation CLI
- Bias detection in summarization (meta-analysis heuristics)

---

## 23. License

No license file currently present.  
Recommendation: Add `LICENSE` (MIT preferred for openness unless constraints apply).

---

## 24. Acknowledgements

- NASA Biological & Physical Sciences Division publications dataset (challenge context)
- Open-source ecosystem (Next.js, React, Tailwind, next-intl, remark)
- Future: credit embedding + LLM providers

---

## 25. Disclaimer

This tool synthesizes publicly available research content.  
It does NOT provide medical advice or official NASA policy guidance.  
Always verify critical findings against primary sources.

---

## Quick TL;DR

Neil = AI chat interface over NASA bioscience publications.  
Ask: "How does microgravity affect immune response?"  
Get: Focused, synthesized answer grounded in experiments.  
Interact via text or voice. Future: knowledge graph + analytics dashboard.

---

If you need this README further aligned once more code is added (e.g., actual retrieval layer), let me know and I can tailor it precisely to the implemented modules.

🚀 Exploring space biology—one question at a time.