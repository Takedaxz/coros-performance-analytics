"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WaveThinkingText } from "@/components/WaveThinkingText";
import { removeLegacyEvidenceUsed } from "./answer-display";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOL_LABELS: Record<string, string> = {
  compare_activities: "Workout comparison",
  get_activities: "Activities",
  get_activity_detail: "Workout details",
  get_fitness_history: "Fitness history",
  get_health_trend: "Health & recovery",
  get_scheduled_workout_details: "Workout details",
  get_training_plan: "Training plan",
  search_coaching_knowledge: "Coaching library",
  search_live_coaching_sources: "Web sources",
  web_search: "Web sources",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/^get_/, "").replaceAll("_", " ");
}

function AiGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SourcesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CopyMessageButton({ content, label }: { content: string; label: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1_500);
  };

  const status = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : `Copy ${label}`;

  return (
    <button
      className={`message-copy-button${copyState === "failed" ? " is-failed" : ""}`}
      type="button"
      aria-label={status}
      title={status}
      onClick={() => void handleCopy()}
    >
      {copyState === "copied" ? <CheckIcon /> : copyState === "failed" ? <XIcon /> : <CopyIcon />}
    </button>
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

function parseThinkingAndAnswer(rawContent: string): { thinking: string | null; answer: string; isThinkingActive: boolean } {
  if (!rawContent.includes("<think>")) {
    return { thinking: null, answer: rawContent, isThinkingActive: false };
  }

  const thinkStartIndex = rawContent.indexOf("<think>");
  const thinkEndIndex = rawContent.indexOf("</think>");

  if (thinkEndIndex !== -1) {
    const thinking = rawContent.slice(thinkStartIndex + 7, thinkEndIndex).trim();
    const answer = (rawContent.slice(0, thinkStartIndex) + rawContent.slice(thinkEndIndex + 8)).trim();
    return { thinking: thinking || null, answer, isThinkingActive: false };
  }

  const thinking = rawContent.slice(thinkStartIndex + 7).trim();
  const answer = rawContent.slice(0, thinkStartIndex).trim();
  return { thinking: thinking || null, answer, isThinkingActive: true };
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform var(--transition-fast)",
      }}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ThinkingAccordion({ thinking, isThinkingActive }: { thinking: string; isThinkingActive: boolean }) {
  const [isOpen, setIsOpen] = useState(isThinkingActive);

  useEffect(() => {
    if (isThinkingActive) {
      setIsOpen(true);
    }
  }, [isThinkingActive]);

  return (
    <details
      className={`ai-thinking-accordion ${isThinkingActive ? "is-active" : ""}`}
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
    >
      <summary>
        <span>{isThinkingActive ? <WaveThinkingText text="Thinking" /> : "Thought process"}</span>
        <ChevronIcon isOpen={isOpen} />
      </summary>
      <div className="ai-thinking-accordion-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown>
      </div>
    </details>
  );
}

type Session = {
  id: string;
  title: string;
  is_pinned: boolean;
  model_name: string;
  created_at: string;
  updated_at: string;
};

type ProviderGroup = {
  id: string;
  name: string;
  models: { id: string; name: string }[];
};

type ModelsResponse = {
  models: string[];
  providers?: ProviderGroup[];
  default_model: string;
};

type Message = {
  role: "user" | "ai";
  content: string;
  tools?: string[];
};

type DBMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: string[];
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
  const [sessionPendingDelete, setSessionPendingDelete] = useState<Session | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const aiResponseRef = useRef("");
  // Prevents the activeSessionId effect from fetching + overwriting messages while a send is in progress
  const isStreamingRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (sessionPendingDelete && !dialog.open) dialog.showModal();
    if (!sessionPendingDelete && dialog.open) dialog.close();
  }, [sessionPendingDelete]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions`);
      if (res.ok) {
        const data: Session[] = await res.json();
        setSessions(data);
        // Auto-restore the exact session the user had open before navigation.
        // Only restore if that session still exists — never auto-select data[0]
        // to avoid silently landing on an empty ghost session.
        const saved = sessionStorage.getItem("ai_active_session");
        const match = saved && data.find((session) => session.id === saved);
        setActiveSessionId((current) => current || (match ? match.id : null));
        if (match) setSelectedModel(match.model_name);
      }
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    fetch(`${API_BASE}/api/ai/models`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data: ModelsResponse) => {
        setAvailableModels(data.models);
        setProviders(data.providers ?? []);
        setDefaultModel(data.default_model);
        setSelectedModel((current) => current || data.default_model);
      })
      .catch(() => {
        setAvailableModels([]);
        setProviders([]);
      });
  }, []);

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
          tools: m.tool_calls,
        })));
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages([]);
        }
      }
    })();
    return () => controller.abort();
  }, [activeSessionId]);


  async function createRealSession(): Promise<Session | null> {
    const res = await fetch(`${API_BASE}/api/ai/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: selectedModel || defaultModel || null }),
    });
    if (!res.ok) return null;
    const session: Session = await res.json();
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setSelectedModel(session.model_name);
    return session;
  }

  function handleNewChat() {
    if (isLoading) return;
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setSelectedModel(defaultModel);
    sessionStorage.removeItem("ai_active_session");
  }

  const handleDeleteSession = async (id: string) => {
    setSessionPendingDelete(null);
    try {
      await fetch(`${API_BASE}/api/ai/sessions/${id}`, { method: "DELETE" });
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
        setSelectedModel(defaultModel);
        sessionStorage.removeItem("ai_active_session");
      }
      fetchSessions();
    } catch (err) {
      console.error("Failed to delete session", err);
    }
  };

  const handleUpdateSession = async (
    id: string,
    updates: { title?: string; is_pinned?: boolean; model_name?: string },
  ) => {
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

  async function handleModelChange(modelName: string) {
    const previousModel = selectedModel;
    setSelectedModel(modelName);
    if (!activeSessionId) return;

    try {
      const res = await fetch(`${API_BASE}/api/ai/sessions/${activeSessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_name: modelName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Session = await res.json();
      setSessions((current) =>
        current.map((session) => session.id === updated.id ? updated : session)
      );
    } catch {
      setSelectedModel(previousModel);
    }
  }

  async function handleSend(forcedInput?: string, sessionId?: string, overrideHistory?: Message[]) {
    const userMsg = (forcedInput ?? input).trim();
    const sid = sessionId ?? activeSessionId;
    if (!userMsg || !sid) return;

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
          history: baseHistory.slice(-12).map((m) => ({
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
                if (parsed.tool) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const last = updated.at(-1);
                    if (last?.role === "ai") last.tools = [...(last.tools ?? []), parsed.tool];
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
    await handleSend("Generate a weekly briefing", sid);
  }

  async function handleChipClick(chip: (typeof SUGGESTED_PROMPTS)[number]) {
    if (isLoading) return;
    let sid = activeSessionId;
    if (!sid) {
      const s = await createRealSession();
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
  function renderEmptyPrompt(sessionId?: string) {
    const inputId = sessionId ? "new-session-input" : "empty-state-input";

    return (
      <div className="ai-link-empty-prompt">
        <div className="ai-link-empty-intro">
          <p className="ai-link-empty-label"><AiGlyph /> Training intelligence</p>
          <h1>What would you like to improve?</h1>
          <p>AI will answer based on your recent training, recovery, sleep, and calendar data.</p>
        </div>

        <div className="ai-link-empty-composer">
          <div className="cmd-bar-wrap">
            <textarea
              id={inputId}
              className="cmd-bar"
              placeholder="How can I improve my recovery score?"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!input.trim()) return;
                  const msg = input.trim();
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
          <p className="ai-link-composer-meta">AI can make mistakes. Verify critical training decisions.</p>
        </div>

        <div className="ai-link-suggestions">
          <p>Start with a focus</p>
          <div className="prompt-chips-row" role="list" aria-label="Suggested prompts">
            {[...SUGGESTED_PROMPTS, ...goals.filter(g => g.goal_race_date && new Date(g.goal_race_date) >= new Date(new Date().setHours(0, 0, 0, 0))).map(g => ({ label: `Plan a training block for ${g.goal_race_name}`, action: "ask" as const }))].map((chip) => (
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
      </div>
    );
  }

  return (
    <div className="ai-link-layout print-block">
      <Sidebar />
      <main className="ai-link-main print-block">
        <header className="page-header print-hide">
          <PageTitle>AI Coach</PageTitle>
          <div className="ai-link-header-actions">
            <label className="ai-link-model-picker">
              <span>Model</span>
              <select
                aria-label="AI model"
                value={selectedModel}
                onChange={(event) => handleModelChange(event.target.value)}
                disabled={isLoading || availableModels.length === 0}
              >
                {providers.length > 0 ? (
                  providers.map((provider) => (
                    <optgroup key={provider.id} label={provider.name}>
                      {provider.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))
                ) : (
                  availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model.includes(":") ? model.split(":", 2)[1] : model}
                    </option>
                  ))
                )}
              </select>
            </label>
            {activeSessionId && !isEmpty && (
              <>
                <button className="ai-link-tool-button" onClick={handleExportMarkdown} title="Export as Markdown">
                  <DownloadIcon /> Export MD
                </button>
                <button className="ai-link-tool-button" onClick={handlePrint} title="Print / Save as PDF">
                  <PrintIcon /> Print PDF
                </button>
              </>
            )}
          </div>
        </header>

        <div className="ai-link-workspace">

          {/* ── Sessions sidebar ── */}
          <aside className="ai-link-sessions print-hide">
            <div className="ai-link-session-header">
              <span>Sessions</span>
              <button
                id="new-chat-btn"
                className="ai-link-new-chat"
                onClick={handleNewChat}
                disabled={isLoading}
              >
                <PlusIcon /> New
              </button>
            </div>

            <div className="ai-link-session-list">
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
                      onClick={() => {
                        if (!isLoading) {
                          setActiveSessionId(s.id);
                          setSelectedModel(s.model_name);
                        }
                      }}
                      onMouseEnter={() => setHoveredSessionId(s.id)}
                      onMouseLeave={() => setHoveredSessionId(null)}
                      style={{
                        padding: "var(--space-2)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        background: isActive ? "rgba(33, 230, 165, 0.10)" : isHovered ? "var(--color-surface-secondary)" : "transparent",
                        border: isActive ? "1px solid rgba(33, 230, 165, 0.28)" : "1px solid transparent",
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
                            <p style={{ alignItems: "center", display: "flex", fontSize: "10px", gap: "6px", color: "var(--color-text-muted)", margin: "2px 0 0", lineHeight: 1 }}>
                              {relativeTime(s.updated_at)}
                              {s.is_pinned && <span className="ai-session-pinned-label">Pinned</span>}
                            </p>
                          </>
                        )}
                      </div>
                      {editingSessionId !== s.id && (s.is_pinned || isHovered || isActive) && (
                        <details
                          className="ai-session-menu"
                          name="ai-session-menu"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.currentTarget.removeAttribute("open");
                              event.currentTarget.querySelector("summary")?.focus();
                            }
                          }}
                        >
                          <summary className="ai-session-menu-trigger" aria-label={`Actions for ${s.title}`}>
                            <span aria-hidden="true">⋮</span>
                          </summary>
                          <div className="ai-session-menu-popover" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                handleUpdateSession(s.id, { is_pinned: !s.is_pinned });
                                event.currentTarget.closest("details")?.removeAttribute("open");
                              }}
                            >
                              {s.is_pinned ? "Unpin" : "Pin"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                setEditingSessionId(s.id);
                                setEditingTitle(s.title);
                                event.currentTarget.closest("details")?.removeAttribute("open");
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={(event) => {
                                setSessionPendingDelete(s);
                                event.currentTarget.closest("details")?.removeAttribute("open");
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* ── Chat panel ── */}
          <div className="ai-link-chat-panel print-block">
            <div className="ai-link-chat-body">

              {/* No session selected */}
            {!activeSessionId ? (
              <div className="ai-link-empty print-hide">
                {renderEmptyPrompt()}
              </div>

            ) : isEmpty ? (
              /* Session created but no messages yet */
              <div className="ai-link-empty print-hide">
                {renderEmptyPrompt(activeSessionId)}
              </div>

              ) : (
                /* Active conversation */
                <>
                  <h1 className="print-only-title" style={{ display: "none" }}>AI Coach Session</h1>
                  <div id="chat-history" className="ai-link-chat-history print-block">
                    <div className="ai-link-thread print-block">
                      {messages.map((msg, idx) => {
                        const isErrorMsg = idx === messages.length - 1 && msg.role === "ai" && (msg.content.includes("Error") || msg.content.includes("Failed"));
                        if (msg.role === "user") {
                          return (
                            <div key={idx} className="msg-row user-row msg-enter" style={{ animationDelay: "0ms" }}>
                              <div className="user-message-content">
                                <div className="user-pill">{msg.content}</div>
                                <div className="message-copy-actions">
                                  <CopyMessageButton content={msg.content} label="your message" />
                                </div>
                              </div>
                            </div>
                          );
                        }
                        const { thinking, answer, isThinkingActive } = parseThinkingAndAnswer(msg.content);
                        const displayAnswer = removeLegacyEvidenceUsed(answer);
                        const tools = msg.tools ? [...new Set(msg.tools)] : [];
                        return (
                          <div key={idx} className="msg-row ai-row msg-enter" style={{ animationDelay: "0ms" }}>
                            <div className="ai-text">
                              {thinking && (
                                <ThinkingAccordion thinking={thinking} isThinkingActive={isThinkingActive} />
                              )}
                              {msg.content === "" && isLoading ? (
                                <WaveThinkingText text="thinking" />
                              ) : displayAnswer ? (
                                <div className="markdown-body">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayAnswer.replaceAll(" -- ", " — ")}</ReactMarkdown>
                                </div>
                              ) : null}
                              {tools.length > 0 && (
                                <div className="ai-tool-calls" aria-label={`Evidence consulted: ${tools.map(toolLabel).join(", ")}`}>
                                  <span className="ai-tool-calls-icon" aria-hidden="true">
                                    <SourcesIcon />
                                  </span>
                                  {tools.map((tool) => (
                                    <span className="ai-tool-chip" key={tool}>
                                      {toolLabel(tool)}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {displayAnswer && (
                                <div className="message-copy-actions">
                                  <CopyMessageButton content={displayAnswer} label="coach response" />
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
                          <div className="ai-text">
                            <WaveThinkingText text="thinking" />
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  <div className="chat-input-bar ai-link-composer print-hide">
                    <div className="chat-input-bar-inner">
                      <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
                        <textarea
                          id="chat-input"
                          className="cmd-bar"
                          placeholder="Ask your coach anything..."
                          value={input}
                          onChange={(e) => {
                            setInput(e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              if (!input.trim()) return;
                              handleSend();
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
                          }}
                          disabled={isLoading || !input.trim()}
                          aria-label="Send message"
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
        </div>

        <dialog
          ref={deleteDialogRef}
          className="ai-delete-dialog"
          aria-labelledby="delete-session-title"
          aria-describedby="delete-session-description"
          onCancel={() => setSessionPendingDelete(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSessionPendingDelete(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSessionPendingDelete(null);
          }}
        >
          <div className="ai-delete-dialog-content">
            <span className="ai-delete-dialog-label">Delete session</span>
            <h2 id="delete-session-title">Delete this chat?</h2>
            <p id="delete-session-description">
              “{sessionPendingDelete?.title}” and its messages will be permanently deleted.
            </p>
            <div className="ai-delete-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                autoFocus
                onClick={() => setSessionPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn ai-delete-dialog-confirm"
                onClick={() => {
                  if (sessionPendingDelete) handleDeleteSession(sessionPendingDelete.id);
                }}
              >
                Delete chat
              </button>
            </div>
          </div>
        </dialog>
      </main>
    </div>
  );
}
