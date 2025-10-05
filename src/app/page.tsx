"use client";
import { useState, useRef, useEffect, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessage { role: 'user' | 'assistant'; content: string }

type ChatMode = 'Discovery' | 'Scientific' | 'Investor' | 'Architect';

interface Suggestion { title: string; link: string }

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('Discovery');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [modeOpen, setModeOpen] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load/save mode in localStorage
  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('chat_mode') : null;
      if (saved === 'Discovery' || saved === 'Scientific' || saved === 'Investor' || saved === 'Architect') {
        setMode(saved as ChatMode);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem('chat_mode', mode);
    } catch {}
  }, [mode]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput('');
    setLoading(true);
    try {
      const historyToSend = [...messages];
      let idx = -1;
      setMessages((m) => {
        const userMessage: ChatMessage = { role: 'user', content: question };
        const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '' };
        const next: ChatMessage[] = [...m, userMessage, assistantPlaceholder];
        idx = next.length - 1;
        return next;
      });
      // Now call the API with previous history
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ question, mode, history: historyToSend }),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/plain')) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          let acc = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
            setMessages((m) => {
              const copy = [...m];
              copy[idx] = { role: 'assistant', content: acc };
              return copy;
            });
          }
        } else {
          // Fallback
          const text = await res.text();
          setMessages((m) => {
            const copy = [...m];
            copy[idx] = { role: 'assistant', content: text };
            return copy;
          });
        }
      } else {
        const json = await res.json();
        setMessages((m) => {
          const copy = [...m];
          copy[idx] = { role: 'assistant', content: json.answer || json.error || 'Erreur.' };
          return copy;
        });
      }
    } catch (_e: unknown) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Erreur de serveur.' }]);
    } finally {
      setLoading(false);
    }
  }

  // Fetch random CSV suggestions for the hero view
  useEffect(() => {
    if (messages.length > 0) return; // only for landing
    fetch('/api/suggestions')
      .then((r) => r.json())
      .then((j) => setSuggestions(j.suggestions || []))
      .catch(() => setSuggestions([]));
  }, [messages.length]);

  const modes: Array<{ value: ChatMode; label: string; icon: ReactNode; desc: string }> = [
    { value: 'Discovery', label: 'Discovery', icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M16 8l-4 8-4-4 8-4z" />
      </svg>
    ), desc: 'General and balanced response' },
    { value: 'Scientific', label: 'Scientific', icon: (<svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12" />
      <path d="M9 2v6l-5 9a4 4 0 0 0 3.5 6h9A4 4 0 0 0 20 17l-5-9V2" />
    </svg>), desc: 'Focused on methods, data, citations' },
    { value: 'Investor', label: 'Investor', icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 15l4-4 3 3 4-6" />
      </svg>
    ), desc: 'Focused on market, ROI, risks, roadmap' },
    { value: 'Architect', label: 'Architect', icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="12" rx="2" />
        <path d="M7 21h10" />
        <path d="M12 15v6" />
      </svg>
    ), desc: 'Focused on architecture, integration, constraints' },
  ];

  function ModeDropdown() {
    const current = modes.find((m) => m.value === mode)!;
    return (
      <div className="relative">
        <h1 className="text-xl font-black mb-2">Neil AI</h1>
        <button
          onClick={() => setModeOpen((v) => !v)}
          className="flex items-center gap-2 bg-black/50 backdrop-blur text-white text-sm px-3 py-2 rounded border border-white/20 shadow"
        >
          <span>{current.icon}</span>
          <span className="font-medium">{current.label}</span>
          <span className="ml-1">▾</span>
        </button>
        {modeOpen && (
          <div className="absolute z-20 mt-2 w-64 bg-black/80 text-white rounded border border-white/10 backdrop-blur shadow-lg">
            {modes.map((m) => (
              <button
                key={m.value}
                onClick={() => {
                  setMode(m.value);
                  setModeOpen(false);
                }}
                className={`w-full text-left px-3 py-2 hover:bg-white/10 flex items-start gap-2 ${
                  m.value === mode ? 'bg-white/10' : ''
                }`}
              >
                <span className="mt-0.5">{m.icon}</span>
                <span>
                  <div className="font-medium">{m.label}</div>
                  <div className="text-xs text-white/70">{m.desc}</div>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Landing hero (no messages yet)
  if (messages.length === 0) {
    return (
      <div className="min-h-screen w-full bg-[url('/space-background.jpg')] bg-cover bg-center bg-fixed relative">
        <div className="bg-black/60 backdrop-blur-sm">
          {/* Mode selector */}
        <div className="fixed top-4 left-4 z-10"><ModeDropdown /></div>

{/* Center content */}
<div className="flex flex-col items-center justify-center min-h-screen gap-6 px-4">
  {/* Suggestions row */}
  <div className="flex flex-wrap justify-center gap-3">
    {suggestions.map((s, i) => (
      <a
        key={i}
        href={s.link}
        target="_blank"
        rel="noreferrer"
        className="group relative flex items-center gap-2 px-3 py-2 rounded-full bg-black/40 text-white border border-white/10 hover:border-white/30 shadow-sm"
        title={s.title}
      >
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
        <span className="truncate max-w-[220px] text-sm">{s.title}</span>

        {/* Hover preview tooltip */}
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 bg-black/80 text-white text-xs rounded p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="font-medium mb-1 truncate">{s.title}</div>
          <div className="text-[11px] text-white/70 truncate">{s.link}</div>
        </div>
      </a>
    ))}
  </div>

  {/* Headline */}
  <div className="text-center text-white drop-shadow-md">
    <h1 className="text-4xl md:text-8xl font-semibold">AVATAR</h1>
  </div>

  <div className="text-center text-white drop-shadow-md">
    <h1 className="text-4xl md:text-5xl font-semibold">Hey, You.</h1>
    <p className="mt-2 text-base md:text-lg text-white/80">Ready to dive into the fascinating research of NASA?</p>
  </div>

  {/* Centered input */}
  <form onSubmit={sendMessage} className="w-full max-w-2xl">
    <div className="flex items-center gap-2 bg-black/50 backdrop-blur rounded-2xl px-4 py-3 border border-white/10">
      <input
        className="flex-1 bg-transparent text-white placeholder:text-white/60 focus:outline-none text-sm md:text-base"
        placeholder="Ask anything / Pose ta question"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        type="submit"
        disabled={loading}
        className="shrink-0 w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 text-white grid place-items-center disabled:opacity-50"
        aria-label="Envoyer"
      >
        ➤
      </button>
    </div>
  </form>
  <div className="text-center text-white/50 text-xs">A tiny mistakes.</div>
</div>
        </div>
      </div>
    );
  }

  // Chat layout (after first message)
  return (
    <div className="min-h-screen w-full bg-[url('/space-background.jpg')] bg-cover bg-center bg-fixed relative">
      <div className="bg-black/60 backdrop-blur-sm">
        {/* Mode selector */}
      <div className="fixed top-4 left-4 z-10"><ModeDropdown /></div>

<div className="flex flex-col h-[100vh] max-w-3xl mx-auto px-4 py-6">
  <div className="flex-1 overflow-y-auto scroll-hide space-y-4 pr-2">
    {messages.map((m, i) => (
      <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
        {m.role === 'user' ? (
          <div className={`inline-block px-3 py-2 rounded-lg text-sm whitespace-pre-wrap bg-blue-600 text-white`}>
            {m.content}
          </div>
        ) : (
          <div className="inline-block max-w-full text-sm bg-gray-200 dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    ))}
    {loading && (
      <div className="text-sm text-gray-200 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-white/70 animate-pulse" />
        <span className="inline-block w-2 h-2 rounded-full bg-white/60 animate-pulse [animation-delay:150ms]" />
        <span className="inline-block w-2 h-2 rounded-full bg-white/50 animate-pulse [animation-delay:300ms]" />
        <span>Réflexion…</span>
      </div>
    )}
    <div ref={bottomRef} />
  </div>

  {/* Chat input styled like hero input */}
  <form onSubmit={sendMessage} className="w-full">
    <div className="flex items-center gap-2 bg-black/50 backdrop-blur rounded-2xl px-4 py-3 border border-white/10">
      <input
        className="flex-1 bg-transparent text-white placeholder:text-white/60 focus:outline-none text-sm md:text-base"
        placeholder="Ask anything / Pose ta question"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        type="submit"
        disabled={loading}
        className="shrink-0 w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 text-white grid place-items-center disabled:opacity-50"
        aria-label="Envoyer"
      >
        ➤
      </button>
    </div>
  </form>
</div>
      </div>
    </div>
  );
}
