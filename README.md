This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## AI Chat Feature

A multilingual chat page is available at `/chat`.

### Environment variables (`.env.local`)

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
OPENROUTER_REFERER=http://localhost:3000
OPENROUTER_TITLE=neil-engine
```

Only `OPENROUTER_API_KEY` is strictly required (get one from https://openrouter.ai/). You can change the model. The API route lives at `src/app/api/chat/route.ts`.

### How it works

1. The UI (`src/app/chat/page.tsx`) maintains the message list locally.
2. On send, it POSTs messages to `/api/chat`.
3. The API route forwards them to OpenRouter and returns the assistant reply.
4. The conversation supports any language; simply type in the language you prefer.

### Customization ideas
- Enable streaming responses (convert fetch to stream the body).
- Persist chat history (e.g. localStorage or a database).
- Add speech-to-text for the microphone button.
- Add system prompt to control persona.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Space Biology Article Enrichment & Summarization

The `/api/chat` endpoint now detects queries related to space / microgravity biology. When triggered it can:

1. Return a list of related articles (CSV sourced).
2. Optionally scrape each article (main text + figure images) and generate a consolidated scientific summary.

### Request Body Extension

```
{
	"messages": [ { "role": "user", "content": "Explain microgravity effects on stem cells" } ],
	"summarize": true
}
```

If `summarize` is omitted or false you will receive only `mode: "articles_only"` with the selected article list (no scraping). When true, response mode becomes `articles_summary` including scraped content and an LLM-produced synthesis.

### Response Modes

| mode | Description |
|------|-------------|
| (absent) | Standard chat completion (topic not matched) |
| `articles_only` | Article list only (no scraping / summary) |
| `articles_summary` | Scraped articles + structured summary |

### Scraped Article Object

```
{
	title: string,
	link: string,
	text: string,      // truncated to 20k chars
	images: [ { src: string, alt?: string, caption?: string } ] // up to 12 figures
}
```

### Environment Variables

Add (or extend) your `.env.local`:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL_PRIMARY=meta-llama/llama-3.3-70b-instruct:free
OPENROUTER_MODEL_SUMMARY=meta-llama/llama-3.1-8b-instruct:free
SPACE_BIO_CSV_URL=https://raw.githubusercontent.com/jgalazka/SB_publications/refs/heads/main/SB_publication_PMC.csv
SPACE_BIO_MAX_ARTICLES=8
```

### Scraping Notes

* Uses `node-html-parser` in the edge runtime.
* Selects `<main>` first, falling back to `<article>` then `<body>`.
* Removes noisy tags: script, style, nav, header, footer, aside.
* Collects `<figure>` images (absolutized `src`, includes alt + caption).
* 30‑minute in-memory cache (per edge region) to avoid repeated fetching.

### Example

```
curl -X POST http://localhost:3000/api/chat \
	-H 'Content-Type: application/json' \
	-d '{"messages":[{"role":"user","content":"Recent microgravity muscle atrophy research"}],"summarize":true}'
```

### Future Ideas
* Persist scraped content in a durable KV / database.
* Add user-controlled filters (year, topic keywords).
* Stream summary generation for faster UX feedback.
* Add citation extraction & structured metadata parsing.

## Direct Scraping Endpoint `/api/scrape`

If vous possédez déjà une liste d'articles `{ title, link }`, vous pouvez directement récupérer le contenu principal et les figures sans passer par la détection de requête de `/api/chat`.

### Requête

```
POST /api/scrape
Content-Type: application/json

{
	"articles": [
		{ "title": "Example 1", "link": "https://example.org/article-1" },
		{ "title": "Example 2", "link": "https://example.org/article-2" }
	]
}
```

Limitations:
* Max 12 articles par appel.
* Chaque lien doit commencer par `http`.
* Le texte est tronqué à ~20k caractères; jusqu'à 12 figures collectées.

### Réponse

```
{
	"articles": [
		{
			"title": "Example 1",
			"link": "https://example.org/article-1",
			"text": "Main content ...",
			"images": [ { "src": "https://.../fig1.png", "alt": "", "caption": "Figure legend ..." } ]
		}
	]
}
```

### cURL

```
curl -X POST http://localhost:3000/api/scrape \
	-H 'Content-Type: application/json' \
	-d '{"articles":[{"title":"Ex","link":"https://example.org"}]}'
```

### Notes Techniques
* Réutilise les mêmes fonctions de scraping que `/api/chat` (`src/lib/scrape.ts`).
* Cache mémoire 30 min (contenu réutilisé si relance sur même URL).
* Aucune clé API requise pour cette route (attention à usage abusif côté déploiement public).
