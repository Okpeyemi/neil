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
