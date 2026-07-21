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

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function PinnedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

type Session = {
  id: string;
  title: string;
  is_pinned: boolean;
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
  const diff = Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
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
  const [goals, setGoals] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [planDaysBack, setPlanDaysBack] = useState(7);
  const [planDaysForward, setPlanDaysForward] = useState(14);
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

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/goals`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setGoals(data))
      .catch(() => setGoals([]));
  }, []);

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
        is_pinned: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, ...cleanPrev];
    });
    setActiveSessionId(tempId);
    setMessages([]);
  }

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id.startsWith("temp-")) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
      return;
    }
    try {
      await fetch(`${API_BASE}/api/ai/sessions/${id}`, { method: "DELETE" });
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
        sessionStorage.removeItem("ai_active_session");
      }
      fetchSessions();
    } catch (err) {
      console.error("Failed to delete session", err);
    }
  };

  const handleUpdateSession = async (id: string, updates: { title?: string; is_pinned?: boolean }) => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        fetchSessions();
      }
    } catch (err) {
      console.error("Failed to update session", err);
    }
  };

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
          plan_days_back: planDaysBack,
          plan_days_forward: planDaysForward,
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
    if (isLoading) return;
    if (sid.startsWith("temp-")) {
      const realSession = await createRealSession(sid);
      if (!realSession) return;
      sid = realSession.id;
    }
    await handleSend("Generate a weekly briefing", sid);
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

  function handleExportMarkdown() {
    if (messages.length === 0) return;
    const session = sessions.find(s => s.id === activeSessionId);
    const title = session ? session.title : "AI Coach Session";
    
    let mdContent = `# ${title}\n\n`;
    messages.forEach(m => {
      mdContent += `### ${m.role === 'user' ? 'You' : 'AI Coach'}\n${m.content}\n\n`;
    });
    
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'chat'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  const isEmpty = messages.length === 0;

  // Shared empty-state content (prompt bar + chips)
  function EmptyPrompt({ sessionId }: { sessionId?: string }) {
    return (
      <div style={{ width: "100%", maxWidth: "600px", display: "flex", flexDirection: "column", gap: "var(--space-3)", position: "relative", zIndex: 1 }}>
        <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
          <textarea
            id={sessionId ? "new-session-input" : "empty-state-input"}
            className="cmd-bar"
            placeholder="How can I improve my recovery score?"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "56px";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!input.trim()) return;
                const msg = input.trim();
                e.currentTarget.style.height = "56px";
                if (!sessionId) {
                  const s = await createRealSession();
                  if (s) handleSend(msg, s.id);
                } else {
                  handleSend(msg, sessionId);
                }
              }
            }}
            disabled={isLoading}
            autoFocus
            style={{
              resize: "none",
              paddingTop: "16px",
              paddingBottom: "16px",
              lineHeight: "1.4",
              overflowY: "auto"
            }}
            rows={1}
          />
          <button
            id={sessionId ? "new-session-send-btn" : "empty-state-send-btn"}
            className="cmd-bar-send"
            onClick={async () => {
              if (!input.trim()) return;
              const msg = input.trim();
              const el = document.getElementById(sessionId ? "new-session-input" : "empty-state-input");
              if (el) el.style.height = "56px";
              if (!sessionId) {
                const s = await createRealSession();
                if (s) handleSend(msg, s.id);
              } else {
                handleSend(msg, sessionId);
              }
            }}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            style={{ top: "auto", bottom: "8px", transform: "none" }}
          >
            <SendIcon />
          </button>
        </div>
        {!sessionId && <p className="input-hint" style={{ textAlign: "center" }}>↵ Enter to send</p>}
        <div className="prompt-chips-row" role="list" aria-label="Suggested prompts">
          {[...SUGGESTED_PROMPTS, ...goals.filter(g => g.goal_race_date && new Date(g.goal_race_date) >= new Date(new Date().setHours(0,0,0,0))).map(g => ({ label: `Plan a training block for ${g.goal_race_name}`, action: "ask" as const }))].map((chip) => (
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
    <div className="app-layout print-block">
      <Sidebar />
      <main className="main-content print-block" style={{ display: "flex", flexDirection: "row", overflow: "hidden", padding: 0 }}>

        {/* ── Sessions sidebar ── */}
        <div className="print-hide" style={{
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
                      {editingSessionId === s.id ? (
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleUpdateSession(s.id, { title: editingTitle });
                                setEditingSessionId(null);
                              } else if (e.key === "Escape") {
                                setEditingSessionId(null);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              flex: 1,
                              fontSize: "var(--text-xs)",
                              padding: "2px 4px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                              background: "var(--color-bg-primary)",
                              color: "var(--color-text-primary)",
                            }}
                          />
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "2px", color: "var(--color-text-primary)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateSession(s.id, { title: editingTitle });
                              setEditingSessionId(null);
                            }}
                          >
                            <CheckIcon />
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "2px", color: "var(--color-text-muted)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSessionId(null);
                            }}
                          >
                            <XIcon />
                          </button>
                        </div>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                    {editingSessionId !== s.id && (s.is_pinned || isHovered || isActive) && (
                      <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateSession(s.id, { is_pinned: !s.is_pinned });
                          }}
                          style={{ padding: "2px", color: s.is_pinned ? "var(--color-text-primary)" : "var(--color-text-muted)", lineHeight: 1 }}
                          aria-label={s.is_pinned ? "Unpin session" : "Pin session"}
                        >
                          {s.is_pinned ? <PinnedIcon /> : <PinIcon />}
                        </button>
                        {(isHovered || isActive) && (
                          <button
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSessionId(s.id);
                              setEditingTitle(s.title);
                            }}
                            style={{ padding: "2px", color: "var(--color-text-muted)", lineHeight: 1 }}
                            aria-label="Edit session"
                          >
                            <EditIcon />
                          </button>
                        )}
                        {(isHovered || isActive) && (
                          <button
                            id={`delete-session-${s.id}`}
                            className="btn btn-ghost"
                            onClick={(e) => handleDeleteSession(s.id, e)}
                            style={{ padding: "2px", color: "var(--color-text-muted)", lineHeight: 1 }}
                            aria-label="Delete session"
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Chat panel ── */}
        <div className="print-block" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <header className="page-header print-hide">
            <h2 className="page-title">AI Coach</h2>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginRight: "var(--space-4)", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
                <span>Calendar Context:</span>
                <input 
                  type="number" 
                  value={planDaysBack}
                  onChange={(e) => setPlanDaysBack(parseInt(e.target.value) || 0)}
                  style={{ width: "40px", padding: "2px 4px", background: "var(--color-bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", fontSize: "var(--text-xs)" }}
                  title="Days back"
                />
                <span>days back,</span>
                <input 
                  type="number" 
                  value={planDaysForward}
                  onChange={(e) => setPlanDaysForward(parseInt(e.target.value) || 0)}
                  style={{ width: "40px", padding: "2px 4px", background: "var(--color-bg-primary)", border: "1px solid var(--border-color)", borderRadius: "4px", fontSize: "var(--text-xs)" }}
                  title="Days forward"
                />
                <span>days forward</span>
              </div>
              {activeSessionId && !isEmpty && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={handleExportMarkdown} title="Export as Markdown" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <DownloadIcon /> Export MD
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={handlePrint} title="Print / Save as PDF" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <PrintIcon /> Print PDF
                  </button>
                </>
              )}
            </div>
          </header>

          <div className="page-body" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>

            {/* No session selected */}
            {!activeSessionId ? (
              <div className="print-hide" style={{
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
              <div className="print-hide" style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "var(--space-8) var(--space-4)", gap: "var(--space-4)", position: "relative", overflow: "hidden",
              }}>
                <div aria-hidden="true" style={{
                  position: "absolute", inset: 0, pointerEvents: "none",
                  backgroundImage: ["linear-gradient(rgba(0,0,0,0.07) 1px, transparent 1px)", "linear-gradient(90deg, rgba(0,0,0,0.07) 1px, transparent 1px)"].join(", "),
                  backgroundSize: "24px 24px",
                  WebkitMaskImage: "radial-gradient(ellipse 72% 62% at 50% 50%, black 0%, transparent 78%)",
                  maskImage: "radial-gradient(ellipse 72% 62% at 50% 50%, black 0%, transparent 78%)",
                }} />
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", position: "relative", zIndex: 1 }}>
                  New session — ask anything
                </p>
                <EmptyPrompt sessionId={activeSessionId} />
              </div>

            ) : (
              /* Active conversation */
              <>
                <h1 className="print-only-title" style={{ display: "none" }}>AI Coach Session</h1>
                <div id="chat-history" className="print-block" style={{ flex: 1, overflowY: "auto", padding: "var(--space-6) var(--space-6) var(--space-4)", scrollBehavior: "smooth" }}>
                  <div className="print-block" style={{ maxWidth: "800px", margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: 0, paddingBottom: "var(--space-4)" }}>
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

                <div className="chat-input-bar print-hide">
                  <div className="chat-input-bar-inner">
                    <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
                      <textarea
                        id="chat-input"
                        className="cmd-bar"
                        placeholder="Ask your coach anything..."
                        value={input}
                        onChange={(e) => {
                          setInput(e.target.value);
                          e.target.style.height = "56px";
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (!input.trim()) return;
                            handleSend();
                            e.currentTarget.style.height = "56px";
                          }
                        }}
                        disabled={isLoading}
                        style={{
                          resize: "none",
                          paddingTop: "16px",
                          paddingBottom: "16px",
                          lineHeight: "1.4",
                          overflowY: "auto"
                        }}
                        rows={1}
                      />
                      <button 
                        id="chat-send-btn" 
                        className="cmd-bar-send" 
                        onClick={() => {
                          if (!input.trim()) return;
                          handleSend();
                          const el = document.getElementById("chat-input");
                          if (el) el.style.height = "56px";
                        }} 
                        disabled={isLoading || !input.trim()} 
                        aria-label="Send message"
                        style={{ top: "auto", bottom: "8px", transform: "none" }}
                      >
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
