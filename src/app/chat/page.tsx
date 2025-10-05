"use client";
import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  html?: string;
  markdown?: string;
}
interface Article {
  title: string;
  link: string;
}

type UserMode = "Discovery" | "Scientific" | "Investor" | "Architect";

// Minimal types for Web Speech API to avoid explicit any
type MinimalResultItem = { 0: { transcript: string }; isFinal: boolean };
type MinimalRecognitionEvent = { resultIndex: number; results: MinimalResultItem[] };
interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: MinimalRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

// Extract original source URL if proxied through /api/image?url=
function extractOriginalSrc(s?: string): string {
  if (!s) return "";
  try {
    if (s.startsWith("/api/image?url=")) {
      const u = new URL(
        s,
        typeof window !== "undefined" ? window.location.origin : "http://localhost"
      );
      const orig = u.searchParams.get("url");
      return orig ? decodeURIComponent(orig) : s;
    }
  } catch {
    // ignore
  }
  return s;
}

// Inline image component with skeleton placeholder and proxy fallback
const MarkdownImage: React.FC<{ src?: string; alt?: string; onOpenLightbox?: (src: string, alt?: string) => void } & Omit<React.ComponentProps<typeof Image>, "src" | "alt">> = (props) => {
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState<string>(props.src || "");
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    try {
      const el = e.currentTarget;
      if (el.naturalWidth && el.naturalHeight) {
        setAspectRatio(el.naturalWidth / el.naturalHeight);
      }
    } catch {
      // ignore
    }
    setLoaded(true);
    if (props.onLoad) props.onLoad(e);
  };
  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    try {
      const el = e.currentTarget;
      const tried = el.dataset?.triedProxy === "1";
      const currentSrc = src || el.currentSrc || el.src;
      if (!tried && currentSrc && !currentSrc.startsWith("/api/image?url=") && !currentSrc.startsWith("data:")) {
        el.dataset.triedProxy = "1";
        setSrc(`/api/image?url=${encodeURIComponent(currentSrc)}`);
        return;
      }
    } catch {
      // ignore
    }
    if (props.onError) props.onError(e);
  };
  return (
    <div className="relative w-full my-2">
      {!loaded && (
        <div className="w-full h-60 max-h-[60vh] bg-neutral-800/60 rounded-md animate-pulse" />
      )}
      <div
        className="relative w-full min-h-[260px] sm:min-h-[300px] md:min-h-[40vh] lg:min-h-[50vh] cursor-zoom-in"
        style={{ aspectRatio: aspectRatio ?? 16/9, maxHeight: "90vh" }}
        onClick={() => props.onOpenLightbox?.(extractOriginalSrc(src || props.src) || "", props.alt)}
        role="button"
        aria-label="Voir l'image en plein écran"
      >
        <Image
          ref={imgRef}
          src={src || ""}
          alt={props.alt || ""}
          fill
          sizes="(max-width: 768px) 100vw, 85vw"
          onLoad={handleLoad}
          onError={handleError}
          style={{
            objectFit: "contain",
            objectPosition: "center",
            display: "block",
            margin: "0.25rem 0",
            opacity: loaded ? 1 : 0,
            transition: "opacity 200ms ease",
          }}
          unoptimized
        />
      </div>
    </div>
  );
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [usedArticles, setUsedArticles] = useState<Article[] | null>(null);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [recording, setRecording] = useState<boolean>(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean>(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Ref pour maintenir l'état le plus récent des messages (évite tout décalage d'ordre)
  const messagesRef = useRef<Message[]>([]);
  const [lightbox, setLightbox] = useState<{ src: string; alt?: string } | null>(null);
  const [userMode, setUserMode] = useState<UserMode>("Discovery");
  const [randomArticles, setRandomArticles] = useState<Article[] | null>(null);
  const [randomLoading, setRandomLoading] = useState<boolean>(false);

  const MODE_OPTIONS: { label: UserMode; key: UserMode; icon: React.ReactNode; desc: string }[] = [
    {
      label: "Discovery",
      key: "Discovery",
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M16 8l-4 8-4-4 8-4z" />
        </svg>
      ),
      desc: "Réponse générale et équilibrée",
    },
    {
      label: "Scientific",
      key: "Scientific",
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2h12" />
          <path d="M9 2v6l-5 9a4 4 0 0 0 3.5 6h9A4 4 0 0 0 20 17l-5-9V2" />
        </svg>
      ),
      desc: "Focalisée méthodes, données, citations",
    },
    {
      label: "Investor",
      key: "Investor",
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 15l4-4 3 3 4-6" />
        </svg>
      ),
      desc: "Marché, ROI, risques, feuille de route",
    },
    {
      label: "Architect",
      key: "Architect",
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="12" rx="2" />
          <path d="M7 21h10" />
          <path d="M12 15v6" />
        </svg>
      ),
      desc: "Architecture, intégration, contraintes",
    },
  ];

  function toServerMode(m: UserMode): "discovery" | "scientific" | "investor" | "architect" {
    switch (m) {
      case "Scientific":
        return "scientific";
      case "Investor":
        return "investor";
      case "Architect":
        return "architect";
      default:
        return "discovery";
    }
  }

  // --- Pre-input random articles (client-side fetch) ---
  function parseCsvClient(csv: string): Article[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const titleIdx = header.findIndex((h) => h.startsWith('title'));
    const linkIdx = header.findIndex((h) => h === 'link' || h === 'url');
    if (titleIdx === -1 || linkIdx === -1) return [];
    const out: Article[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= Math.max(titleIdx, linkIdx)) continue;
      const title = cols[titleIdx].trim();
      const link = cols[linkIdx].trim();
      if (title && link && /^https?:\/\//i.test(link)) out.push({ title, link });
    }
    return out;
  }

  function pickRandom<T>(arr: T[], n: number): T[] {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        setRandomLoading(true);
        const CSV_URL = 'https://raw.githubusercontent.com/jgalazka/SB_publications/refs/heads/main/SB_publication_PMC.csv';
        const res = await fetch(CSV_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        const arts = parseCsvClient(text);
        const selected = pickRandom(arts, 3);
        if (!canceled) setRandomArticles(selected);
      } catch {
        // ignore
      } finally {
        if (!canceled) setRandomLoading(false);
      }
    }
    load();
    return () => { canceled = true; };
  }, []);
  // --- End pre-input random articles ---

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    messagesRef.current = messages; // synchronise la ref
  }, [messages, articles, usedArticles]);

  // Load saved mode from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("neil:userMode");
      if (saved === "Discovery" || saved === "Scientifiques" || saved === "Investisseurs" || saved === "Architects") {
        setUserMode(saved as UserMode);
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist mode on change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("neil:userMode", userMode);
    } catch {
      // ignore
    }
  }, [userMode]);

  // Initialiser la reconnaissance vocale si dispo
  useEffect(() => {
    if (typeof window !== "undefined") {
      const w = window as unknown as {
        SpeechRecognition?: new () => MinimalSpeechRecognition;
        webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
      };
      const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.lang = "fr-FR";
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (e: MinimalRecognitionEvent) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const transcript = e.results[i][0].transcript;
            if (e.results[i].isFinal) {
              setInput((prev) => (prev ? prev + " " : "") + transcript.trim());
            } else {
              interim += transcript;
            }
          }
          // Optionnel: afficher l'interim dans placeholder (non stocké)
          if (inputRef.current)
            inputRef.current.placeholder = interim
              ? "… " + interim
              : "Ask anything";
        };
        recognition.onerror = () => {
          setRecording(false);
        };
        recognition.onend = () => {
          setRecording(false);
        };
        recognitionRef.current = recognition;
      }
    }
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  function toggleRecording() {
    if (!speechSupported) return;
    if (!recording) {
      try {
        recognitionRef.current?.start();
        setRecording(true);
      } catch {
        /* ignore start errors */
      }
    } else {
      recognitionRef.current?.stop();
      setRecording(false);
      if (inputRef.current)
        inputRef.current.placeholder = "Ask anything";
    }
  }

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    // Ajoute immédiatement le message utilisateur (ordre garanti)
    setMessages((prev) => {
      const updated = [...prev, userMessage];
      messagesRef.current = updated;
      return updated;
    });
    messagesRef.current = [...messagesRef.current, userMessage];
    setInput("");
    setLoading(true);
    try {
      // Construire le payload à partir de la ref la plus fraîche
      const payloadMessages = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMessages, mode: toServerMode(userMode) }),
      });
      const data: {
        reply?: string;
        error?: string;
        articles?: Article[];
        mode?: string;
        usedArticles?: Article[];
        html?: string;
        markdown?: string;
        fusion?: { sections: { heading: string; markdown: string; images: { src: string; alt?: string; caption?: string; citeIndex?: number }[] }[] };
      } = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      // Generic markdown-first rendering (e.g., chitchat, capabilities)
      if (data.markdown) {
        console.log("GENERIC_MARKDOWN", { mode: data.mode, mdLen: data.markdown.length });
        const replyMd: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          markdown: data.markdown,
        };
        setMessages((m) => {
          const updated = [...m, replyMd];
          messagesRef.current = updated;
          return updated;
        });
        setArticles(data.articles || null);
        setUsedArticles(data.usedArticles || data.articles || null);
      } else if (data.mode === "articles_only") {
        // Toujours fournir une réponse assistant même si seulement des articles
        const arts = data.articles || [];
        setArticles(arts.length ? arts : null);
        setUsedArticles(null);
        const listMd = arts.length
          ? `Sources found:\n\n${arts
              .map((a, i) => `${i + 1}. [${a.title}](${a.link})`)
              .join("\n")}`
          : "No sources found.";
        const replyList: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          markdown: listMd,
        };
        setMessages((prev) => {
          const updated = [...prev, replyList];
          messagesRef.current = updated;
          return updated;
        });
      } else if (data.mode === "fused_articles") {
        const replyMd: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          markdown: data.markdown || "",
        };
        setMessages((m) => {
          const updated = [...m, replyMd];
          messagesRef.current = updated;
          return updated;
        });
        setArticles(data.articles || null);
        setUsedArticles(data.articles || null);
      } else if (data.mode === "fused_json") {
        // Build Markdown from server-fused JSON (sections + resolved images)
        console.log("FUSED_JSON", data.fusion);
        const secs = data.fusion?.sections || [];
        const mdCore = secs
          .map((sec) => {
            const body = sec.markdown || "";
            const imgs = (sec.images || [])
              .map((im) => {
                const cap = im.caption
                  ? `\n_${im.caption}${im.citeIndex ? ` [${im.citeIndex}]` : ""}_`
                  : "";
                return `![${im.alt || ""}](${im.src})${cap}`;
              })
              .join("\n\n");
            return `## ${sec.heading || ""}\n\n${body}\n\n${imgs}`.trim();
          })
          .join("\n\n");
        const sources = (data.articles || []).map((a, i) => `- [${i + 1}] [${a.title}](${a.link})`).join("\n");
        const finalMd = mdCore + (sources ? `\n\n### Sources\n${sources}` : "");
        console.log("FUSED_JSON_STATS", {
          sections: secs.length,
          images: secs.reduce((acc, s) => acc + (s.images?.length || 0), 0),
          sources: (data.articles || []).length,
          mdLen: finalMd.length,
        });
        const replyMd: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          markdown: finalMd,
        };
        setMessages((m) => {
          const updated = [...m, replyMd];
          messagesRef.current = updated;
          return updated;
        });
        setArticles(data.articles || null);
        setUsedArticles(data.articles || null);
      } else if (data.mode === "scraped") {
        const replyHtml: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          html: data.html || "",
        };
        setMessages((m) => {
          const updated = [...m, replyHtml];
          messagesRef.current = updated;
          return updated;
        });
        setArticles(data.articles || null);
        setUsedArticles(data.articles || null);
      } else {
        const reply: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply || "",
        };
        setMessages((m) => {
          const updated = [...m, reply];
          messagesRef.current = updated;
          return updated;
        });
        setArticles(
          data.articles && data.articles.length ? data.articles : null
        );
        setUsedArticles(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "inconnue";
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Erreur / Error: " + message,
      };
      setMessages((m) => {
        const updated = [...m, errorMessage];
        messagesRef.current = updated;
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Open lightbox from HTML-rendered content
  function handleHtmlImageClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      const original = extractOriginalSrc(img.currentSrc || img.src);
      setLightbox({ src: original, alt: img.alt || "" });
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "0px";
      const scrollH = inputRef.current.scrollHeight;
      const clamped = Math.min(scrollH, 160); // max ~8 lignes
      inputRef.current.style.height = clamped + "px";
    }
  }, [input]);

  // Close lightbox on ESC and lock scroll
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightbox]);

  // const displayArticles = usedArticles || articles; // no longer used

  return (
    <div className="min-h-screen w-full bg-[url('/space-background.jpg')] bg-cover bg-center bg-fixed">
      <div className="flex flex-col items-center justify-center h-screen w-full mx-auto bg-black/60 backdrop-blur-sm sm:px-4 py-4">
        {/* Mode selector (shadcn-style) */}
        <div className="w-full px-4 mb-2">
          <div className="relative inline-block text-left">
            <div className="group">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-200 shadow-sm hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                onClick={(e) => {
                  const el = (e.currentTarget.nextSibling as HTMLElement) || null;
                  if (el) el.classList.toggle("hidden");
                }}
                aria-haspopup="listbox"
                aria-expanded="false"
              >
                {MODE_OPTIONS.find((o) => o.key === userMode)?.icon}
                <span>{userMode}</span>
                <svg viewBox="0 0 24 24" className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <div className="absolute left-0 mt-1 min-w-[220px] rounded-lg border border-neutral-700 bg-neutral-900/95 shadow-xl hidden z-20">
                <ul role="listbox" className="max-h-80 overflow-auto py-1">
                  {MODE_OPTIONS.map((opt) => (
                    <li
                      key={opt.key}
                      role="option"
                      aria-selected={userMode === opt.key}
                      onClick={(e) => {
                        setUserMode(opt.key);
                        // close dropdown
                        const parent = (e.currentTarget.parentElement?.parentElement) as HTMLElement | null;
                        parent?.classList.add("hidden");
                      }}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-800 ${userMode === opt.key ? "bg-neutral-800" : ""}`}
                    >
                      <span className="text-neutral-200">{opt.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-sm text-neutral-100">{opt.label}</span>
                        <span className="text-[11px] text-neutral-400">{opt.desc}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
        <div
          className="flex-1 px-4 w-full max-w-4xl overflow-auto scroll-hide"
          ref={listRef}
        >
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-neutral-300/80 select-none gap-6">
            {/* Random articles previews above the input */}
            {(randomLoading || (randomArticles && randomArticles.length > 0)) && (
              <div className="w-full max-w-3xl mx-auto">
                <h3 className="text-sm font-bold text-neutral-200 mb-2">Articles de la NASA</h3>
                {randomLoading && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-20 rounded-xl bg-neutral-900/60 border border-neutral-800 animate-pulse" />
                    ))}
                  </div>
                )}
                {randomArticles && randomArticles.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    {randomArticles.map((a, idx) => {
                      let hostname = '';
                      try { hostname = new URL(a.link).hostname; } catch {}
                      const icon = hostname ? `https://icons.duckduckgo.com/ip3/${hostname}.ico` : '';
                      return (
                        <a
                          key={idx}
                          href={a.link}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="group flex gap-3 items-start p-3 rounded-xl bg-neutral-900/80 border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-900 transition text-left"
                        >
                          {icon ? (
                            <img src={icon} alt="" className="w-5 h-5 mt-0.5 rounded-sm opacity-80" />
                          ) : (
                            <div className="w-5 h-5 mt-0.5 rounded-sm bg-neutral-700" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-neutral-100 text-sm font-medium truncate">{a.title}</div>
                            {hostname && (
                              <div className="text-[11px] text-neutral-400 truncate">{hostname}</div>
                            )}
                          </div>
                          <svg viewBox="0 0 24 24" className="w-4 h-4 text-neutral-400 opacity-0 group-hover:opacity-80 transition" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M7 17l9-9" />
                            <path d="M7 7h9v9" />
                          </svg>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
              <div>
                <h1 className="text-5xl font-black mb-4 drop-shadow">
                  Hey, You.
                </h1>
                <p className="text-2xl font-medium mb-4 drop-shadow">
                  Ready to dive into the fascinating research of NASA?
                </p>
              </div>
              {/* Centered input form before first message */}
              <form onSubmit={sendMessage} className="w-full mx-auto">
                <div className="flex items-center gap-2 bg-neutral-900/80 border border-neutral-700 rounded-2xl p-4 backdrop-blur shadow-lg">
                  <textarea
                    ref={inputRef}
                    className="flex-1 bg-transparent outline-none text-sm placeholder-neutral-500 resize-none leading-relaxed min-h-[24px] max-h-40 scroll-hide scroll-hide"
                    placeholder="Ask anything / Pose ta question"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    disabled={loading}
                    autoFocus
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={toggleRecording}
                      title={
                        speechSupported
                          ? recording
                            ? "Arrêter la dictée"
                            : "Dicter un message"
                          : "Reconnaissance vocale non supportée"
                      }
                      className={`p-2 transition cursor-pointer ${
                        speechSupported
                          ? "text-neutral-400 hover:text-neutral-200"
                          : "text-neutral-600 cursor-not-allowed"
                      } ${recording ? "text-blue-400 mic-recording" : ""}`}
                      disabled={!speechSupported || loading}
                    >
                      {recording ? (
                        <svg
                          viewBox="0 0 24 24"
                          className="w-5 h-5"
                          fill="currentColor"
                        >
                          <rect x="9" y="5" width="6" height="14" rx="1" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" />
                          <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                          <path d="M12 19v3" />
                          <path d="M8 22h8" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !input.trim()}
                      className="h-9 w-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition text-white cursor-pointer"
                    >
                      {loading ? (
                        <span className="animate-spin border-2 border-white/40 border-t-white rounded-full w-4 h-4" />
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="w-5 h-5"
                          fill="currentColor"
                        >
                          <path d="M3.4 20.6a1 1 0 0 1-.29-1.02l2.18-7.07a1 1 0 0 1 .71-.69l7.41-1.85a.2.2 0 0 0 .02-.38L6 7.23a1 1 0 0 1-.55-1.52l2.1-3.15A1 1 0 0 1 8.33 2l12.13 8.09a1 1 0 0 1-.17 1.76L4.08 21a1 1 0 0 1-.68.02Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-center mt-3 text-neutral-500">
                  AI may make mistakes.
                </p>
              </form>
            </div>
          )}
          <div className={`space-y-4 ${messages.length > 0 ? "pb-40" : ""}`}>
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2 ${
                  m.role === "user" ? "justify-end" : "justify-start"
                } message-appear`}
              >
                {/* Avatar assistant */}
                {m.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-700 to-indigo-700 border border-indigo-400/40 flex items-center justify-center text-white shadow">
                    <svg viewBox="0 0 24 24" className="w-5 h-5">
                      <path
                        fill="currentColor"
                        d="M12 2a7 7 0 0 0-7 7v3.25A3.75 3.75 0 0 0 8.75 16H9a3 3 0 0 0 6 0h.25A3.75 3.75 0 0 0 19 12.25V9a7 7 0 0 0-7-7Zm0 2a5 5 0 0 1 5 5v3.25c0 .966.784 1.75 1.75 1.75h-2.172a2.996 2.996 0 0 0-5.156 0H9.25A1.75 1.75 0 0 1 7.5 12.25V9a5 5 0 0 1 5-5Zm-3 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                      />
                    </svg>
                  </div>
                )}
                {m.markdown ? (
                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[80%] md:max-w-[85%] text-sm shadow-sm bg-neutral-900/70 text-neutral-100 border border-neutral-700`}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener"
                            className="text-blue-400 hover:underline"
                          />
                        ),
                        img: ({ src, alt }) => (
                          <MarkdownImage
                            src={typeof src === "string" ? src : ""}
                            alt={alt || ""}
                            onOpenLightbox={(s, a) => setLightbox({ src: s, alt: a })}
                          />
                        ),
                        h1: ({ ...props }) => (
                          <h1
                            {...props}
                            className="text-xl font-semibold mt-2 mb-2"
                          />
                        ),
                        h2: ({ ...props }) => (
                          <h2
                            {...props}
                            className="text-lg font-semibold mt-2 mb-2"
                          />
                        ),
                        h3: ({ ...props }) => (
                          <h3
                            {...props}
                            className="text-base font-semibold mt-2 mb-2"
                          />
                        ),
                        p: ({ ...props }) => (
                          <p {...props} className="leading-relaxed" />
                        ),
                        ul: ({ ...props }) => (
                          <ul
                            {...props}
                            className="list-disc list-inside space-y-1"
                          />
                        ),
                        ol: ({ ...props }) => (
                          <ol
                            {...props}
                            className="list-decimal list-inside space-y-1"
                          />
                        ),
                        blockquote: ({ ...props }) => (
                          <blockquote
                            {...props}
                            className="border-l-2 border-neutral-600 pl-3 italic"
                          />
                        ),
                        table: ({ ...props }) => (
                          <table
                            {...props}
                            className="min-w-full border border-neutral-700 text-xs"
                          />
                        ),
                        th: ({ ...props }) => (
                          <th
                            {...props}
                            className="border border-neutral-700 px-2 py-1"
                          />
                        ),
                        td: ({ ...props }) => (
                          <td
                            {...props}
                            className="border border-neutral-700 px-2 py-1"
                          />
                        ),
                      }}
                    >
                      {m.markdown}
                    </ReactMarkdown>
                  </div>
                ) : m.html ? (
                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[80%] md:max-w-[85%] text-sm shadow-sm bg-neutral-900/70 text-neutral-100 border border-neutral-700`}
                  >
                    <div
                      className="space-y-3"
                      onClick={handleHtmlImageClick}
                      dangerouslySetInnerHTML={{ __html: m.html }}
                    />
                  </div>
                ) : (
                  <div
                    className={`rounded-2xl px-4 py-2 max-w-[80%] md:max-w-[85%] whitespace-pre-wrap leading-relaxed text-sm shadow-sm ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-neutral-800 text-neutral-100"
                    }`}
                  >
                    {m.content}
                  </div>
                )}
                {m.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 border border-blue-300/40 flex items-center justify-center text-[10px] font-semibold text-white shadow">
                    YOU
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start gap-2 message-appear">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-700 to-indigo-700 border border-indigo-400/40 flex items-center justify-center text-white shadow">
                  <svg viewBox="0 0 24 24" className="w-5 h-5">
                    <path
                      fill="currentColor"
                      d="M12 2a7 7 0 0 0-7 7v3.25A3.75 3.75 0 0 0 8.75 16H9a3 3 0 0 0 6 0h.25A3.75 3.75 0 0 0 19 12.25V9a7 7 0 0 0-7-7Zm0 2a5 5 0 0 1 5 5v3.25c0 .966.784 1.75 1.75 1.75h-2.172a2.996 2.996 0 0 0-5.156 0H9.25A1.75 1.75 0 0 1 7.5 12.25V9a5 5 0 0 1 5-5Zm-3 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    />
                  </svg>
                </div>
                <div className="rounded-2xl px-4 py-3 bg-neutral-900/70 text-neutral-300 text-sm border border-neutral-700 flex items-center">
                  <div className="typing-dots flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-neutral-500 inline-block"></span>
                    <span className="w-2 h-2 rounded-full bg-neutral-500 inline-block"></span>
                    <span className="w-2 h-2 rounded-full bg-neutral-500 inline-block"></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {messages.length > 0 && (
          <form
            onSubmit={sendMessage}
            className="fixed bottom-0 left-0 right-0 w-full bg-gradient-to-t from-black/90 via-black/60 to-transparent"
          >
            <div className="max-w-4xl mx-auto p-4">
              <div className="flex items-center gap-2 bg-neutral-900/80 border border-neutral-700 rounded-2xl p-4 backdrop-blur shadow-lg">
                <textarea
                  ref={inputRef}
                  className="flex-1 bg-transparent outline-none text-sm placeholder-neutral-500 resize-none leading-relaxed min-h-[24px] max-h-40 scroll-hide"
                  placeholder="Ask anything"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={loading}
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleRecording}
                    title={
                      speechSupported
                        ? recording
                          ? "Stop dictation"
                          : "Dictation"
                        : "Speech recognition not supported"
                    }
                    className={`p-2 transition ${
                      speechSupported
                        ? "text-neutral-400 hover:text-neutral-200"
                        : "text-neutral-600 cursor-not-allowed"
                    } ${recording ? "text-blue-400 mic-recording" : ""}`}
                    disabled={!speechSupported || loading}
                  >
                    {recording ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5"
                        fill="currentColor"
                      >
                        <rect x="9" y="5" width="6" height="14" rx="1" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" />
                        <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                        <path d="M12 19v3" />
                        <path d="M8 22h8" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="h-9 w-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition text-white"
                  >
                    {loading ? (
                      <span className="animate-spin border-2 border-white/40 border-t-white rounded-full w-4 h-4" />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5"
                        fill="currentColor"
                      >
                        <path d="M3.4 20.6a1 1 0 0 1-.29-1.02l2.18-7.07a1 1 0 0 1 .71-.69l7.41-1.85a.2.2 0 0 0 .02-.38L6 7.23a1 1 0 0 1-.55-1.52l2.1-3.15A1 1 0 0 1 8.33 2l12.13 8.09a1 1 0 0 1-.17 1.76L4.08 21a1 1 0 0 1-.68.02Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-center mt-2 text-neutral-500">
                AI can make mistakes.
              </p>
            </div>
          </form>
        )}
      </div>
      {lightbox && (
        <div
          className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-[95vw] h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute -top-10 right-0 text-neutral-300 hover:text-white transition"
              onClick={() => setLightbox(null)}
            >
              ✕ Close (Esc)
            </button>
            <a
              href={lightbox.src}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute -top-10 left-0 text-neutral-300 hover:text-white underline"
              aria-label="Open original in new tab"
            >
              Open original ↗
            </a>
            <Image
              src={lightbox.src}
              alt={lightbox.alt || ""}
              fill
              sizes="100vw"
              style={{ objectFit: 'contain' }}
              className="rounded-md shadow-2xl"
              unoptimized
            />
            {lightbox.alt && (
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-3 py-1 rounded text-xs text-neutral-200">
                {lightbox.alt}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
