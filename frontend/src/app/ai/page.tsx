"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import ReactMarkdown from "react-markdown";

// Lightning bolt SVG for AI avatar
function AiGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

// Arrow-up send icon
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

// Retry icon
function RetryIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  );
}

type Message = { role: "user" | "ai"; content: string };

const SUGGESTED_PROMPTS: { label: string; action?: "briefing" | "ask" }[] = [
  { label: "Weekly Briefing", action: "briefing" },
  { label: "Summarize my training load this week", action: "ask" },
  { label: "Is my HRV showing signs of fatigue?", action: "ask" },
  { label: "What should my next workout be?", action: "ask" },
  { label: "Analyze my sleep trends", action: "ask" },
];

export default function AiPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Mutable accumulation buffer for streaming AI response chunks
  const aiResponseRef = useRef("");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    const saved = sessionStorage.getItem("ai_chat_history");
    // Defer the setState so it does not run synchronously inside the effect body
    setTimeout(() => {
      if (saved) {
        try {
          setMessages(JSON.parse(saved));
        } catch {
          // ignore parse errors
        }
      }
      setIsInitialized(true);
    }, 0);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      sessionStorage.setItem("ai_chat_history", JSON.stringify(messages));
    }
  }, [messages, isInitialized]);

  async function handleSend(
    forcedInput?: string,
    overrideHistory?: Message[]
  ) {
    const userMsg = (forcedInput ?? input).trim();
    if (!userMsg) return;

    const baseHistory = overrideHistory ?? messages;
    const nextHistory: Message[] = [...baseHistory, { role: "user", content: userMsg }];
    setMessages(nextHistory);
    if (!forcedInput) setInput("");
    setIsLoading(true);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/ai/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMsg,
          context_days: 14,
          history: baseHistory.slice(-4),
        }),
      });

      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "ai", content: "Error communicating with AI backend." }]);
        setIsLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages((prev) => [...prev, { role: "ai", content: "No readable response body from AI backend." }]);
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      setMessages((prev) => [...prev, { role: "ai", content: "" }]);

      // Use a ref so mutations don't trigger the immutability lint rule
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
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: snapshot,
                      };
                    }
                    return updated;
                  });
                }
              } catch {
                // incomplete JSON chunk — skip
              }
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      setMessages((prev) => [...prev, { role: "ai", content: "Failed to connect to AI coach." }]);
    }
    setIsLoading(false);
  }

  async function handleRetry() {
    if (messages.length < 2) return;
    if (messages[messages.length - 1].role !== "ai") return;

    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return;

    const lastUserMsg = userMessages[userMessages.length - 1].content;
    const cleanHistory = messages.slice(0, -2);
    setMessages(cleanHistory);
    await handleSend(lastUserMsg, cleanHistory);
  }

  async function generateBriefing() {
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: "Generate a weekly briefing" }]);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/ai/briefing`);
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "ai", content: data.briefing }]);
      } else {
        setMessages((prev) => [...prev, { role: "ai", content: "Error generating briefing." }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "ai", content: "Failed to fetch briefing." }]);
    }
    setIsLoading(false);
  }

  function handleChipClick(chip: (typeof SUGGESTED_PROMPTS)[number]) {
    if (isLoading) return;
    if (chip.action === "briefing") {
      generateBriefing();
    } else {
      handleSend(chip.label);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {/* Header — title + clear only */}
        <header className="page-header">
          <h2 className="page-title">AI Performance Coach</h2>
          <button
            id="clear-chat-btn"
            className="btn btn-ghost"
            onClick={() => setMessages([])}
            disabled={isLoading || messages.length === 0}
          >
            Clear Chat
          </button>
        </header>

        <div
          className="page-body"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: 0,
          }}
        >
          {/* ── Empty state: Spotlight command bar ── */}
          {isEmpty ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                boxSizing: "border-box",
                padding: "var(--space-8) var(--space-4)",
                gap: "var(--space-5)",
                /* needed for the absolute-positioned pixel grid overlay */
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Pixel grid background — pointer-events:none, fades radially from center */}
              <div
                aria-hidden="true"
                className="pixel-grid-bg"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  backgroundImage: [
                    "linear-gradient(rgba(0,0,0,0.07) 1px, transparent 1px)",
                    "linear-gradient(90deg, rgba(0,0,0,0.07) 1px, transparent 1px)",
                  ].join(", "),
                  backgroundSize: "24px 24px",
                  WebkitMaskImage:
                    "radial-gradient(ellipse 72% 62% at 50% 50%, black 0%, transparent 78%)",
                  maskImage:
                    "radial-gradient(ellipse 72% 62% at 50% 50%, black 0%, transparent 78%)",
                }}
              />

              {/* Label */}
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                Ask your coach anything
              </p>

              {/* Single constrained block: input + hint + chips */}
              <div
                style={{
                  width: "100%",
                  maxWidth: "600px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {/* Command bar */}
                <div className="cmd-bar-wrap" style={{ maxWidth: "100%" }}>
                  <input
                    id="empty-state-input"
                    ref={inputRef}
                    className="cmd-bar"
                    type="text"
                    placeholder="How can I improve my recovery score?"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    disabled={isLoading}
                    autoFocus
                  />
                  <button
                    id="empty-state-send-btn"
                    className="cmd-bar-send"
                    onClick={() => handleSend()}
                    disabled={isLoading || !input.trim()}
                    aria-label="Send message"
                  >
                    <SendIcon />
                  </button>
                </div>

                {/* Enter hint */}
                <p className="input-hint" style={{ textAlign: "center" }}>↵ Enter to send</p>

                {/* Prompt chips */}
                <div
                  className="prompt-chips-row"
                  role="list"
                  aria-label="Suggested prompts"
                >
                  {SUGGESTED_PROMPTS.map((chip) => (
                    <button
                      key={chip.label}
                      id={`chip-${chip.label.toLowerCase().replace(/\s+/g, "-")}`}
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
          ) : (
            /* ── Active conversation ── */
            <>
              {/* Message list */}
              <div
                id="chat-history"
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "var(--space-6) var(--space-6) var(--space-4)",
                  scrollBehavior: "smooth",
                }}
              >
                <div
                  style={{
                    maxWidth: "800px",
                    margin: "0 auto",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    paddingBottom: "var(--space-4)",
                  }}
                >
                  {messages.map((msg, idx) => {
                    const isErrorMsg =
                      idx === messages.length - 1 &&
                      msg.role === "ai" &&
                      (msg.content.includes("Error") || msg.content.includes("Failed"));

                    if (msg.role === "user") {
                      return (
                        <div
                          key={idx}
                          className={`msg-row user-row msg-enter`}
                          style={{ animationDelay: "0ms" }}
                        >
                          {/* User monogram avatar */}
                          <div className="avatar-sq user" aria-hidden="true">YOU</div>
                          {/* User pill */}
                          <div className="user-pill">{msg.content}</div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={idx}
                        className={`msg-row ai-row msg-enter`}
                        style={{ animationDelay: "0ms" }}
                      >
                        {/* AI glyph avatar */}
                        <div className="avatar-sq ai" aria-label="AI Coach">
                          <AiGlyph />
                        </div>

                        {/* AI text content */}
                        <div className="ai-text">
                          {msg.content === "" && isLoading ? (
                            /* Inline thinking indicator */
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                color: "var(--color-text-muted)",
                                fontSize: "var(--text-xs)",
                                fontFamily: "var(--font-mono)",
                                paddingTop: "2px",
                              }}
                            >
                              thinking
                              <span className="chat-loading-dots" aria-label="Loading">
                                <span className="chat-loading-dot" />
                                <span className="chat-loading-dot" />
                                <span className="chat-loading-dot" />
                              </span>
                            </span>
                          ) : (
                            <div className="markdown-body">
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                            </div>
                          )}

                          {/* Retry on error */}
                          {isErrorMsg && (
                            <div style={{ marginTop: "var(--space-3)" }}>
                              <button
                                id="retry-btn"
                                className="btn btn-secondary btn-sm"
                                onClick={handleRetry}
                                disabled={isLoading}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                }}
                              >
                                <RetryIcon />
                                Retry
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Loading row — only when AI has not yet appended an empty message */}
                  {isLoading && messages[messages.length - 1]?.role !== "ai" && (
                    <div className="msg-row ai-row msg-enter">
                      <div className="avatar-sq ai" aria-hidden="true">
                        <AiGlyph />
                      </div>
                      <div className="ai-text">
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            color: "var(--color-text-muted)",
                            fontSize: "var(--text-xs)",
                            fontFamily: "var(--font-mono)",
                            paddingTop: "2px",
                          }}
                        >
                          thinking
                          <span className="chat-loading-dots" aria-label="Loading">
                            <span className="chat-loading-dot" />
                            <span className="chat-loading-dot" />
                            <span className="chat-loading-dot" />
                          </span>
                        </span>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Bottom input bar */}
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
                    <button
                      id="chat-send-btn"
                      className="cmd-bar-send"
                      onClick={() => handleSend()}
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
      </main>
    </div>
  );
}
