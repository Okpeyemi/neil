"use client";
import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";

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

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [usedArticles, setUsedArticles] = useState<Article[] | null>(null);
  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [recording, setRecording] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean>(false);
  const [mode, setMode] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Ref pour maintenir l'état le plus récent des messages (évite tout décalage d'ordre)
  const messagesRef = useRef<Message[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    messagesRef.current = messages; // synchronise la ref
  }, [messages, articles, usedArticles]);

  // Initialiser la reconnaissance vocale si dispo
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.lang = "fr-FR";
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (e: any) => {
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
              : "Ask anything / Pose ta question";
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
        recognitionRef.current.start();
        setRecording(true);
      } catch {
        /* ignore start errors */
      }
    } else {
      recognitionRef.current.stop();
      setRecording(false);
      if (inputRef.current)
        inputRef.current.placeholder = "Ask anything / Pose ta question";
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
        body: JSON.stringify({ messages: payloadMessages }),
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
      setMode(data.mode || null);
      if (data.mode === "articles_only") {
        // Toujours fournir une réponse assistant même si seulement des articles
        const arts = data.articles || [];
        setArticles(arts.length ? arts : null);
        setUsedArticles(null);
        const listMd = arts.length
          ? `Sources trouvées:\n\n${arts
              .map((a, i) => `${i + 1}. [${a.title}](${a.link})`)
              .join("\n")}`
          : "Aucune source trouvée.";
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

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "0px";
      const scrollH = inputRef.current.scrollHeight;
      const clamped = Math.min(scrollH, 160); // max ~8 lignes
      inputRef.current.style.height = clamped + "px";
    }
  }, [input]);

  const displayArticles = usedArticles || articles;

  return (
    <div className="min-h-screen w-full bg-[url('/space-background.jpg')] bg-cover bg-center bg-fixed">
      <div className="flex flex-col items-center justify-center h-screen w-full mx-auto bg-black/60 backdrop-blur-sm sm:px-4 py-4">
        <div
          className="flex-1 px-4 w-full max-w-4xl overflow-auto scroll-hide"
          ref={listRef}
        >
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-neutral-300/80 select-none gap-6">
              <div>
                <h1 className="text-2xl font-medium mb-4 drop-shadow">
                  Hey, Maqsoud. Ready to dive in?
                </h1>
                <p className="text-xs opacity-70 mx-auto">
                  Pose une question dans n&apos;importe quelle langue. / Ask in
                  any language.
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
                <p className="text-[10px] text-center mt-3 text-neutral-500">
                  L&apos;IA peut se tromper. / AI may make mistakes.
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
                        img: ({ ...props }) => (
                          <img
                            {...props}
                            style={{
                              maxWidth: "100%",
                              height: "auto",
                              display: "block",
                              margin: "0.25rem 0",
                            }}
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
                  placeholder="Ask anything / Pose ta question"
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
                          ? "Arrêter la dictée"
                          : "Dicter un message"
                        : "Reconnaissance vocale non supportée"
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
                L&apos;IA peut se tromper. / AI may make mistakes.
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
