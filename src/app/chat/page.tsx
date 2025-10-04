"use client";
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useRouter } from 'next/navigation';

interface Message { id: string; role: 'user' | 'assistant'; content: string; html?: string; markdown?: string }
interface Article { title: string; link: string }

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [usedArticles, setUsedArticles] = useState<Article[] | null>(null);
  const [input, setInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [mode, setMode] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, articles, usedArticles]);

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: nextMessages.map(m => ({ role: m.role, content: m.content })) }) });
      const data: { reply?: string; error?: string; articles?: Article[]; mode?: string; usedArticles?: Article[]; html?: string; markdown?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setMode(data.mode || null);
      if (data.mode === 'articles_only') {
        setArticles(data.articles || null);
        setUsedArticles(null);
      } else if (data.mode === 'fused_articles') {
        // Render fused Markdown (Introduction, Résultats, Conclusion) with images
        const replyMd: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', markdown: data.markdown || '' };
        setMessages(m => [...m, replyMd]);
        setArticles(data.articles || null);
        setUsedArticles(data.articles || null);
      } else if (data.mode === 'scraped') {
        // Render server-scraped HTML directly in the chat
        const replyHtml: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', html: data.html || '' };
        setMessages(m => [...m, replyHtml]);
        setArticles(data.articles || null);
        setUsedArticles(data.articles || null);
      } else {
        const reply: Message = { id: crypto.randomUUID(), role: 'assistant', content: data.reply || '' };
        setMessages(m => [...m, reply]);
        setArticles(data.articles && data.articles.length ? data.articles : null);
        setUsedArticles(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'inconnue';
      const errorMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: 'Erreur / Error: ' + message };
      setMessages(m => [...m, errorMessage]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      sendMessage();
    }
  }

  const displayArticles = usedArticles || articles;

  return (
    <div className="flex flex-col h-screen w-full max-w-3xl mx-auto">
      <header className="p-4 flex items-center gap-4 text-sm text-neutral-400">
        <button onClick={() => router.push('/')} className="rounded px-2 py-1 border border-neutral-700 hover:bg-neutral-800">Accueil</button>
        <span className="opacity-70">Chat IA Multilingue</span>
      </header>
      <div className="flex-1 overflow-y-auto px-4" ref={listRef}>
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-400 select-none">
            <h1 className="text-2xl font-medium mb-6">Hey, Maqsoud. Ready to dive in?</h1>
            <p className="text-xs opacity-70 max-w-sm">Pose une question dans n&apos;importe quelle langue. / Ask in any language.</p>
          </div>
        )}
        <div className="space-y-4 pb-40">
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.markdown ? (
                <div className={`rounded-2xl px-4 py-3 max-w-[90%] text-sm shadow-sm bg-neutral-900/70 text-neutral-100 border border-neutral-700`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ ...props }) => <a {...props} target="_blank" rel="noopener" className="text-blue-400 hover:underline" />,
                      img: ({ ...props }) => <img {...props} style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0.25rem 0' }} />,
                      h1: ({ ...props }) => <h1 {...props} className="text-xl font-semibold mt-2 mb-2" />,
                      h2: ({ ...props }) => <h2 {...props} className="text-lg font-semibold mt-2 mb-2" />,
                      h3: ({ ...props }) => <h3 {...props} className="text-base font-semibold mt-2 mb-2" />,
                      p: ({ ...props }) => <p {...props} className="leading-relaxed" />,
                      ul: ({ ...props }) => <ul {...props} className="list-disc list-inside space-y-1" />,
                      ol: ({ ...props }) => <ol {...props} className="list-decimal list-inside space-y-1" />,
                      blockquote: ({ ...props }) => <blockquote {...props} className="border-l-2 border-neutral-600 pl-3 italic" />,
                      table: ({ ...props }) => <table {...props} className="min-w-full border border-neutral-700 text-xs" />,
                      th: ({ ...props }) => <th {...props} className="border border-neutral-700 px-2 py-1" />,
                      td: ({ ...props }) => <td {...props} className="border border-neutral-700 px-2 py-1" />,
                    }}
                  >
                    {m.markdown}
                  </ReactMarkdown>
                </div>
              ) : m.html ? (
                <div
                  className={`rounded-2xl px-4 py-3 max-w-[90%] text-sm shadow-sm bg-neutral-900/70 text-neutral-100 border border-neutral-700`}
                >
                  <div
                    className="space-y-3"
                    dangerouslySetInnerHTML={{ __html: m.html }}
                  />
                </div>
              ) : (
                <div className={`rounded-2xl px-4 py-2 max-w-[80%] whitespace-pre-wrap leading-relaxed text-sm shadow-sm ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-100'}`}>{m.content}</div>
              )}
            </div>
          ))}
          {displayArticles && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 bg-neutral-900/70 border border-neutral-700 max-w-[90%] text-sm text-neutral-200 space-y-2">
                <div className="font-semibold text-neutral-100">{mode === 'fused_articles' ? 'Sources utilisées' : mode === 'scraped' ? 'Contenu extrait des sources' : 'Articles liés (biologie spatiale)'}</div>
                <ul className="list-disc list-inside space-y-1">
                  {displayArticles.map((a,i) => (
                    <li key={a.link} className="break-words"><a href={a.link} target="_blank" rel="noopener" className="text-blue-400 hover:underline">[{i+1}] {a.title}</a></li>
                  ))}
                </ul>
                {mode === 'fused_articles' && <p className="text-[10px] opacity-60">Réponse synthétisée uniquement à partir de ces sources citées.</p>}
                {mode === 'articles_only' && <p className="text-[10px] opacity-60">Mode articles uniquement (pas de génération).</p>}
              </div>
            </div>
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-2 bg-neutral-800 text-neutral-400 text-sm animate-pulse">L&apos;IA réfléchit...</div>
            </div>
          )}
        </div>
      </div>
      <form onSubmit={sendMessage} className="fixed bottom-0 left-0 right-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="max-w-3xl mx-auto p-4">
          <div className="flex items-center gap-2 bg-neutral-900/80 border border-neutral-700 rounded-full px-4 py-2 backdrop-blur shadow-lg">
            <button type="button" className="text-neutral-400 hover:text-neutral-200" title="New conversation" onClick={() => { setMessages([]); setArticles(null); setUsedArticles(null); setMode(null); }}>+
            </button>
            <input
              className="flex-1 bg-transparent outline-none text-sm placeholder-neutral-500"
              placeholder="Ask anything / Pose ta question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading}
            />
            <button type="button" title="Micro (non implémenté)" className="text-neutral-500 hover:text-neutral-300">🎤</button>
            <button type="submit" disabled={loading || !input.trim()} className="h-8 w-8 flex items-center justify-center rounded-full bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition">
              {loading ? <span className="animate-spin border-2 border-white/40 border-t-white rounded-full w-4 h-4" /> : '↑'}
            </button>
          </div>
          <p className="text-[10px] text-center mt-2 text-neutral-500">L&apos;IA peut se tromper. / AI may make mistakes.</p>
        </div>
      </form>
    </div>
  );
}
