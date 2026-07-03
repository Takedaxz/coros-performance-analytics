"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function AiGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

type Session = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Message = {
  role: "user" | "ai";
  content: string;
};

type DBMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

const SUGGESTED_PROMPTS: { label: string; action?: "briefing" | "ask" }[] = [
  { label: "Weekly Briefing", action: "briefing" },
  { label: "Summarize my training load this week", action: "ask" },
  { label: "Is my HRV showing signs of fatigue?", action: "ask" },
  { label: "What should my next workout be?", action: "ask" },
  { label: "Analyze my sleep trends", action: "ask" },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AiPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const aiResponseRef = useRef("");
  // Prevents the activeSessionId effect from fetching + overwriting messages while a send is in progress
  const isStreamingRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions`);
      if (res.ok) {
        const data: Session[] = await res.json();
        setSessions(data);
        // Auto-restore the exact session the user had open before navigation.
        // Only restore if that session still exists — never auto-select data[0]
        // to avoid silently landing on an empty ghost session.
        setActiveSessionId((current) => {
          if (current) return current; // already selected, leave it
          const saved = sessionStorage.getItem("ai_active_session");
          const match = saved && data.find((s) => s.id === saved);
          return match ? match.id : null;
        });
      }
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Persist active session to sessionStorage so navigation-remount can restore it
  useEffect(() => {
    if (activeSessionId) sessionStorage.setItem("ai_active_session", activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return; }
    // Skip fetch if a send is in flight — messages are managed by handleSend during streaming
    if (isStreamingRef.current) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/ai/sessions/${activeSessionId}/messages`, {
          signal: controller.signal,
        });
        if (!res.ok) { setMessages([]); return; }
        const dbMsgs: DBMessage[] = await res.json();
        setMessages(dbMsgs.map((m) => ({
          role: m.role === "assistant" ? "ai" : "user",
          content: m.content,
        })));
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages([]);
        }
      }
    })();
    return () => controller.abort();
  }, [activeSessionId]);


  async function createRealSession(tempIdToRemove?: string): Promise<Session | null> {
    const res = await fetch(`${API_BASE}/api/ai/sessions`, { method: "POST" });
    if (!res.ok) return null;
    const session: Session = await res.json();
    setSessions((prev) => {
      const cleanPrev = tempIdToRemove ? prev.filter((s) => s.id !== tempIdToRemove) : prev;
      return [session, ...cleanPrev];
    });
    setActiveSessionId(session.id);
    return session;
  }

  function handleNewChat() {
    if (isLoading) return;
    const tempId = `temp-${Date.now()}`;
    setSessions((prev) => {
      const cleanPrev = prev.filter((s) => !s.id.startsWith("temp-"));
      return [{
        id: tempId,
        title: "New Chat",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, ...cleanPrev];
    });
    setActiveSessionId(tempId);
    setMessages([]);
  }

  async function handleDeleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (id.startsWith("temp-")) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
      return;
    }
    await fetch(`${API_BASE}/api/ai/sessions/${id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }

  async function handleSend(forcedInput?: string, sessionId?: string, overrideHistory?: Message[]) {
    const userMsg = (forcedInput ?? input).trim();
    let sid = sessionId ?? activeSessionId;
    if (!userMsg || !sid) return;

    if (sid.startsWith("temp-")) {
      const realSession = await createRealSession(sid);
      if (!realSession) return;
      sid = realSession.id;
    }

    const baseHistory = overrideHistory ?? messages;
    // Optimistic sidebar update — title and timestamp update immediately on send
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sid
          ? { ...s, title: s.title === "New Chat" ? userMsg.slice(0, 60) : s.title, updated_at: new Date().toISOString() }
          : s
      )
    );
    isStreamingRef.current = true;
    setMessages((prev) => [...(overrideHistory ?? prev), { role: "user", content: userMsg }]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions/${sid}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMsg,
          context_days: 14,
          history: baseHistory.slice(-6).map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "ai", content: "Error communicating with AI backend." }]);
        isStreamingRef.current = false;
        setIsLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages((prev) => [...prev, { role: "ai", content: "No readable response body." }]);
        isStreamingRef.current = false;
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      setMessages((prev) => [...prev, { role: "ai", content: "" }]);
      aiResponseRef.current = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const message = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          for (const line of message.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.substring(6));
                if (parsed.text) {
                  aiResponseRef.current += parsed.text;
                  const snapshot = aiResponseRef.current;
                  setMessages((prev) => {
                    const updated = [...prev];
                    if (updated.length > 0) {
                      updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshot };
                    }
                    return updated;
                  });
                }
              } catch { /* incomplete chunk */ }
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }

    } catch {
      setMessages((prev) => [...prev, { role: "ai", content: "Failed to connect to AI coach." }]);
    }
    isStreamingRef.current = false;
    setIsLoading(false);
  }

  async function handleRetry() {
    if (messages.length < 2 || messages[messages.length - 1].role !== "ai") return;
    const lastUserMsg = messages.filter((m) => m.role === "user").at(-1)?.content;
    if (!lastUserMsg) return;
    const cleanHistory = messages.slice(0, -2);
    setMessages(cleanHistory);
    await handleSend(lastUserMsg, undefined, cleanHistory);
  }

  async function generateBriefing(sid: string) {
    if (sid.startsWith("temp-")) {
      const realSession = await createRealSession(sid);
      if (!realSession) return;
      sid = realSession.id;
    }

    setSessions((prev) =>
      prev.map((s) =>
        s.id === sid
          ? { ...s, title: s.title === "New Chat" ? "Weekly Briefing" : s.title, updated_at: new Date().toISOString() }
          : s
      )
    );
    isStreamingRef.current = true;
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: "Generate a weekly briefing" }]);
    try {
      const res = await fetch(`${API_BASE}/api/ai/briefing`);
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "ai", content: data.briefing }]);
      } else {
        setMessages((prev) => [...prev, { role: "ai", content: "Error generating briefing." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "ai", content: "Failed to fetch briefing." }]);
    }
    isStreamingRef.current = false;
    setIsLoading(false);
    fetchSessions();
  }

  async function handleChipClick(chip: (typeof SUGGESTED_PROMPTS)[number]) {
    if (isLoading) return;
    let sid = activeSessionId;
    if (!sid || sid.startsWith("temp-")) {
      const s = await createRealSession(sid || undefined);
      if (!s) return;
      sid = s.id;
    }
    if (chip.action === "briefing") {
      generateBriefing(sid);
    } else {
      handleSend(chip.label, sid);
    }
  }

  const isEmpty = messages.length === 0;

  // Shared empty-state content (prompt bar + chips)
  function EmptyPrompt({ sessionId }: { sessionId?: string }) {
    return (
      <div style={{ width: "100%", maxWidth: "600px", display: "flex", flexDirection: "column", gap: "var(--space-3)", position: "relative", zIndex: 1 }}>
        <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
          <input
            id={sessionId ? "new-session-input" : "empty-state-input"}
            className="cmd-bar"
            type="text"
            placeholder="How can I improve my recovery score?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key !== "Enter" || !input.trim()) return;
              const msg = input.trim();
              if (!sessionId) {
                const s = await createRealSession();
                if (s) handleSend(msg, s.id);
              } else {
                handleSend(msg, sessionId);
              }
            }}
            disabled={isLoading}
            autoFocus
          />
          <button
            id={sessionId ? "new-session-send-btn" : "empty-state-send-btn"}
            className="cmd-bar-send"
            onClick={async () => {
              if (!input.trim()) return;
              const msg = input.trim();
              if (!sessionId) {
                const s = await createRealSession();
                if (s) handleSend(msg, s.id);
              } else {
                handleSend(msg, sessionId);
              }
            }}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
        {!sessionId && <p className="input-hint" style={{ textAlign: "center" }}>↵ Enter to send</p>}
        <div className="prompt-chips-row" role="list" aria-label="Suggested prompts">
          {SUGGESTED_PROMPTS.map((chip) => (
            <button
              key={chip.label}
              id={`chip-${sessionId ?? "empty"}-${chip.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="prompt-chip"
              role="listitem"
              onClick={() => handleChipClick(chip)}
              disabled={isLoading}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content" style={{ display: "flex", flexDirection: "row", overflow: "hidden", padding: 0 }}>

        {/* ── Sessions sidebar ── */}
        <div style={{
          width: "240px",
          flexShrink: 0,
          borderRight: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--color-bg-secondary)",
        }}>
          <div style={{
            padding: "var(--space-4) var(--space-3) var(--space-3)",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Sessions
            </span>
            <button
              id="new-chat-btn"
              className="btn btn-ghost btn-sm"
              onClick={handleNewChat}
              disabled={isLoading}
              style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px" }}
            >
              <PlusIcon /> New
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-2)" }}>
            {sessionsLoading ? (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "center", padding: "var(--space-4)" }}>Loading…</p>
            ) : sessions.length === 0 ? (
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textAlign: "center", padding: "var(--space-4)" }}>No sessions yet.</p>
            ) : (
              sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                const isHovered = s.id === hoveredSessionId;
                return (
                  <div
                    key={s.id}
                    id={`session-${s.id}`}
                    onClick={() => { if (!isLoading) setActiveSessionId(s.id); }}
                    onMouseEnter={() => setHoveredSessionId(s.id)}
                    onMouseLeave={() => setHoveredSessionId(null)}
                    style={{
                      padding: "var(--space-2)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      background: isActive ? "rgba(99,102,241,0.12)" : isHovered ? "var(--color-bg-tertiary)" : "transparent",
                      border: isActive ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
                      transition: "all var(--transition-fast)",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "var(--space-1)",
                      marginBottom: "2px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        margin: 0,
                        lineHeight: 1.4,
                      }}>
                        {s.title}
                      </p>
                      <p style={{ fontSize: "10px", color: "var(--color-text-muted)", margin: "2px 0 0", lineHeight: 1 }}>
                        {relativeTime(s.updated_at)}
                      </p>
                    </div>
                    {(isHovered || isActive) && (
                      <button
                        id={`delete-session-${s.id}`}
                        className="btn btn-ghost"
                        onClick={(e) => handleDeleteSession(s.id, e)}
                        style={{ padding: "2px", flexShrink: 0, color: "var(--color-text-muted)", lineHeight: 1 }}
                        aria-label="Delete session"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Chat panel ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <header className="page-header">
            <h2 className="page-title">AI Performance Coach</h2>
          </header>

          <div className="page-body" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>

            {/* No session selected */}
            {!activeSessionId ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "var(--space-8) var(--space-4)", gap: "var(--space-5)", position: "relative", overflow: "hidden",
              }}>
                <div aria-hidden="true" style={{
                  position: "absolute", inset: 0, pointerEvents: "none",
                  backgroundImage: ["linear-gradient(rgba(0,0,0,0.07) 1px, transparent 1px)", "linear-gradient(90deg, rgba(0,0,0,0.07) 1px, transparent 1px)"].join(", "),
                  backgroundSize: "24px 24px",
                  WebkitMaskImage: "radial-gradient(ellipse 72% 62% at 50% 50%, black 0%, transparent 78%)",
                  maskImage: "radial-gradient(ellipse 72% 62% at 50% 50%, black 0%, transparent 78%)",
                }} />
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", position: "relative", zIndex: 1 }}>
                  Ask your coach anything
                </p>
                <EmptyPrompt />
              </div>

            ) : isEmpty ? (
              /* Session created but no messages yet */
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "var(--space-8) var(--space-4)", gap: "var(--space-4)",
              }}>
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  New session — ask anything
                </p>
                <EmptyPrompt sessionId={activeSessionId} />
              </div>

            ) : (
              /* Active conversation */
              <>
                <div id="chat-history" style={{ flex: 1, overflowY: "auto", padding: "var(--space-6) var(--space-6) var(--space-4)", scrollBehavior: "smooth" }}>
                  <div style={{ maxWidth: "800px", margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 0, paddingBottom: "var(--space-4)" }}>
                    {messages.map((msg, idx) => {
                      const isErrorMsg = idx === messages.length - 1 && msg.role === "ai" && (msg.content.includes("Error") || msg.content.includes("Failed"));
                      if (msg.role === "user") {
                        return (
                          <div key={idx} className="msg-row user-row msg-enter" style={{ animationDelay: "0ms" }}>
                            <div className="avatar-sq user" aria-hidden="true">YOU</div>
                            <div className="user-pill">{msg.content}</div>
                          </div>
                        );
                      }
                      return (
                        <div key={idx} className="msg-row ai-row msg-enter" style={{ animationDelay: "0ms" }}>
                          <div className="avatar-sq ai" aria-label="AI Coach"><AiGlyph /></div>
                          <div className="ai-text">
                            {msg.content === "" && isLoading ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-muted)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", paddingTop: "2px" }}>
                                thinking
                                <span className="chat-loading-dots" aria-label="Loading">
                                  <span className="chat-loading-dot" /><span className="chat-loading-dot" /><span className="chat-loading-dot" />
                                </span>
                              </span>
                            ) : (
                              <div className="markdown-body">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                              </div>
                            )}
                            {isErrorMsg && (
                              <div style={{ marginTop: "var(--space-3)" }}>
                                <button id="retry-btn" className="btn btn-secondary btn-sm" onClick={handleRetry} disabled={isLoading} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                  <RetryIcon /> Retry
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {isLoading && messages[messages.length - 1]?.role !== "ai" && (
                      <div className="msg-row ai-row msg-enter">
                        <div className="avatar-sq ai" aria-hidden="true"><AiGlyph /></div>
                        <div className="ai-text">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-muted)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", paddingTop: "2px" }}>
                            thinking
                            <span className="chat-loading-dots" aria-label="Loading">
                              <span className="chat-loading-dot" /><span className="chat-loading-dot" /><span className="chat-loading-dot" />
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                <div className="chat-input-bar">
                  <div className="chat-input-bar-inner">
                    <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
                      <input
                        id="chat-input"
                        className="cmd-bar"
                        type="text"
                        placeholder="Ask your coach anything..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSend()}
                        disabled={isLoading}
                      />
                      <button id="chat-send-btn" className="cmd-bar-send" onClick={() => handleSend()} disabled={isLoading || !input.trim()} aria-label="Send message">
                        <SendIcon />
                      </button>
                    </div>
                    <p className="input-hint">AI can make mistakes. Verify critical training decisions.</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
