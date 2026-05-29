"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import ReactMarkdown from "react-markdown";

const SUGGESTED_PROMPTS = [
  "Summarize my training load this week",
  "Is my HRV showing signs of fatigue?",
  "What should my next workout be?",
  "Analyze my sleep trends",
];

export default function AiPage() {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Load from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem("ai_chat_history");
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch {
        // Ignore parse errors
      }
    }
    setIsInitialized(true);
  }, []);

  // Save to sessionStorage on every update
  useEffect(() => {
    if (isInitialized) {
      sessionStorage.setItem("ai_chat_history", JSON.stringify(messages));
    }
  }, [messages, isInitialized]);

  async function handleSend(forcedInput?: string, overrideHistory?: { role: "user" | "ai"; content: string }[]) {
    const userMsg: string = (forcedInput || input).trim();
    if (!userMsg) return;
    
    const baseHistory = overrideHistory || messages;
    const nextHistory = [...baseHistory, { role: "user" as const, content: userMsg }];
    setMessages(nextHistory);
    if (!forcedInput) setInput("");
    setIsLoading(true);

    try {
      const apiBase: string = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res: Response = await fetch(`${apiBase}/api/ai/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          question: userMsg, 
          context_days: 14,
          history: baseHistory.slice(-4) // Send last 4 messages for context
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

      // Keep isLoading true while streaming; it will be cleared after the stream completes.
      const decoder: TextDecoder = new TextDecoder();
      
      // Append an empty AI message to start streaming into
      setMessages((prev) => [...prev, { role: "ai", content: "" }]);
      
      let aiResponse: string = "";
      let buffer: string = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let boundary: number = buffer.indexOf("\n\n");

        while (boundary !== -1) {
          const message: string = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);

          const lines: string[] = message.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(line.substring(6));
                if (parsed.text) {
                  aiResponse += parsed.text;
                  setMessages((prev) => {
                    const updated = [...prev];
                    if (updated.length > 0) {
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        content: aiResponse,
                      };
                    }
                    return updated;
                  });
                }
              } catch (err) {
                // Incomplete JSON or noise
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
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "ai") return;

    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return;
    const lastUserMsg = userMessages[userMessages.length - 1].content;
    
    // Remove the trailing error message and the last user message from the history to re-send
    const cleanHistory = messages.slice(0, -2);
    setMessages(cleanHistory);
    
    // Re-send the last user message with the clean history
    await handleSend(lastUserMsg, cleanHistory);
  }

  async function generateBriefing() {
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: "Generate a weekly briefing" }]);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
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

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">AI Performance Coach</h2>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button 
              className="btn btn-ghost"
              onClick={() => setMessages([])} 
              disabled={isLoading || messages.length === 0}
            >
              Clear Chat
            </button>
            <button className="btn btn-secondary" onClick={generateBriefing} disabled={isLoading}>
              Weekly Briefing
            </button>
          </div>
        </header>

        <div className="page-body" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>
          <div className="chat-layout" style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", scrollBehavior: "smooth" }}>
            
            {messages.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-muted)" }}>
                <div style={{ background: "rgba(139, 92, 246, 0.1)", color: "var(--color-accent-violet)", padding: "16px", borderRadius: "50%", marginBottom: "var(--space-4)" }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h3 style={{ color: "var(--color-text)", fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", marginBottom: "var(--space-2)" }}>How can I help you train today?</h3>
                <p style={{ marginBottom: "var(--space-6)" }}>Ask me about your recent load, HRV, or upcoming workouts.</p>
                
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", justifyContent: "center", maxWidth: "600px" }}>
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button 
                      key={prompt}
                      className="btn btn-ghost" 
                      style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)" }}
                      onClick={() => handleSend(prompt)}
                      disabled={isLoading}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: "800px", margin: "0 auto", width: "100%", paddingBottom: "20px", paddingTop: "24px" }}>
                {messages.map((msg, idx) => (
                  <div key={idx} className={`chat-bubble-row ${msg.role}`} style={{ display: "flex", gap: "12px", marginBottom: "24px", flexDirection: msg.role === "user" ? "row-reverse" : "row", alignItems: "flex-start", justifyContent: "flex-start" }}>
                    
                    {/* Avatar */}
                    <div style={{ flexShrink: 0, width: "32px", height: "32px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: msg.role === "ai" ? "rgba(139, 92, 246, 0.15)" : "var(--color-bg-elevated)", color: msg.role === "ai" ? "var(--color-accent-violet)" : "var(--color-text-secondary)" }}>
                      {msg.role === "ai" ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                        </svg>
                      )}
                    </div>

                    <div className={`chat-bubble ${msg.role}`} style={{ maxWidth: "85%", padding: "16px", borderRadius: "16px", background: msg.role === "user" ? "var(--color-bg-elevated)" : "transparent", border: msg.role === "user" ? "1px solid var(--border-color)" : "none", borderBottomRightRadius: msg.role === "user" ? "4px" : "16px", borderBottomLeftRadius: msg.role === "ai" ? "4px" : "16px" }}>
                      {msg.role === "ai" ? (
                        <div className="markdown-body">
                          <ReactMarkdown>
                            {msg.content}
                          </ReactMarkdown>
                          {(msg.content.includes("Error") || msg.content.includes("Failed")) && idx === messages.length - 1 && (
                            <div style={{ marginTop: "var(--space-2)" }}>
                              <button 
                                className="btn btn-secondary btn-sm" 
                                onClick={handleRetry}
                                disabled={isLoading}
                                style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px" }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                                </svg>
                                Retry
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ whiteSpace: "pre-wrap", color: "var(--color-text)" }}>{msg.content}</div>
                      )}
                    </div>
                  </div>
                ))}
                
                {isLoading && (
                  <div className={`chat-bubble-row ai`} style={{ display: "flex", gap: "12px", marginBottom: "24px", alignItems: "flex-start" }}>
                    <div style={{ flexShrink: 0, width: "32px", height: "32px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(139, 92, 246, 0.15)", color: "var(--color-accent-violet)" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                    <div className="chat-loading animate-fade-in" style={{ padding: "16px", display: "flex", alignItems: "center", gap: "8px", background: "transparent" }}>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>Coach is thinking</span>
                      <span className="chat-loading-dots">
                        <span className="chat-loading-dot" style={{ background: "var(--color-accent-violet)" }}></span>
                        <span className="chat-loading-dot" style={{ background: "var(--color-accent-violet)" }}></span>
                        <span className="chat-loading-dot" style={{ background: "var(--color-accent-violet)" }}></span>
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Floating Input Area */}
          <div style={{ padding: "var(--space-4)", background: "linear-gradient(to top, var(--color-bg-base) 80%, transparent)", flexShrink: 0 }}>
            <div style={{ maxWidth: "800px", margin: "0 auto", position: "relative" }}>
              <input
                type="text"
                placeholder="Ask your coach anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={isLoading}
                style={{
                  width: "100%",
                  padding: "16px 56px 16px 20px",
                  borderRadius: "var(--radius-full)",
                  border: "1px solid var(--border-color)",
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-text)",
                  fontFamily: "var(--font-body)",
                  fontSize: "var(--text-base)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={(e) => e.target.style.borderColor = "var(--color-accent-violet)"}
                onBlur={(e) => e.target.style.borderColor = "var(--border-color)"}
              />
              <button 
                onClick={() => handleSend()} 
                disabled={isLoading || !input.trim()}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "8px",
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: input.trim() ? "var(--color-accent-violet)" : "var(--color-bg-card)",
                  color: input.trim() ? "#fff" : "var(--color-text-muted)",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: input.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.2s"
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
            <div style={{ textAlign: "center", fontSize: "11px", color: "var(--color-text-muted)", marginTop: "12px" }}>
              AI can make mistakes. Verify critical training decisions.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
