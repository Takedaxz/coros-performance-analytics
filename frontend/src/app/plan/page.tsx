"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";

interface TrainingEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  location: string;
  event_type: "run" | "strength" | "swim" | "yoga" | "pilates" | "race" | "other";
  is_all_day: boolean;
}

const EVENT_META: Record<
  TrainingEvent["event_type"],
  { label: string; color: string; bg: string; icon: string }
> = {
  run: {
    label: "Run",
    color: "var(--color-accent-cyan)",
    bg: "rgba(34,211,238,0.1)",
    icon: "M13 4V2m0 2a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4m0-9a4 4 0 0 0-4 4v1a4 4 0 0 0 4 4m0 0v6",
  },
  strength: {
    label: "Strength",
    color: "var(--color-accent-violet)",
    bg: "rgba(139,92,246,0.1)",
    icon: "M6 4v6a6 6 0 0 0 12 0V4M4 4h4m8 0h4",
  },
  swim: {
    label: "Swim",
    color: "var(--color-accent-emerald)",
    bg: "rgba(52,211,153,0.1)",
    icon: "M2 12c1.5-2 3-3 5-3s3.5 1 5 3 3.5 3 5 3M2 19c1.5-2 3-3 5-3s3.5 1 5 3 3.5 3 5 3",
  },
  yoga: {
    label: "Yoga",
    color: "#f97316",
    bg: "rgba(249,115,22,0.1)",
    icon: "M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zM12 22v-6M8 22h8",
  },
  pilates: {
    label: "Pilates",
    color: "#ec4899",
    bg: "rgba(236,72,153,0.1)",
    icon: "M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zM12 22v-6M8 22h8",
  },
  race: {
    label: "Race",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.1)",
    icon: "M3 12h18M12 3l9 9-9 9",
  },
  other: {
    label: "Other",
    color: "var(--color-text-muted)",
    bg: "rgba(255,255,255,0.05)",
    icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  },
};

function formatTime(iso: string, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function groupByDate(events: TrainingEvent[]): Record<string, TrainingEvent[]> {
  const groups: Record<string, TrainingEvent[]> = {};
  for (const ev of events) {
    const key = ev.start.slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(ev);
  }
  return groups;
}

function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function isPast(dateStr: string): boolean {
  return dateStr < new Date().toISOString().slice(0, 10);
}

function EventCard({ ev }: { ev: TrainingEvent }) {
  const meta = EVENT_META[ev.event_type];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="training-event-card"
      style={{
        background: meta.bg,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3) var(--space-4)",
        cursor: ev.description || ev.location ? "pointer" : "default",
        transition: "opacity 0.2s",
        opacity: 1,
      }}
      onClick={() => { if (ev.description || ev.location) setExpanded((x) => !x); }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={meta.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d={meta.icon} />
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--text-sm)", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {ev.summary}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "2px" }}>
            {formatTime(ev.start, ev.is_all_day)}
            {ev.location && ` · ${ev.location.split(",")[0]}`}
          </div>
        </div>
        <span style={{ fontSize: "var(--text-xs)", color: meta.color, fontWeight: "var(--weight-medium)", whiteSpace: "nowrap", background: meta.bg, borderRadius: "var(--radius-sm)", padding: "2px 8px", border: `1px solid ${meta.color}33` }}>
          {meta.label}
        </span>
      </div>
      {expanded && (ev.description || ev.location) && (
        <div style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--border-color)", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          {ev.description && <div style={{ whiteSpace: "pre-line" }}>{ev.description}</div>}
          {ev.location && (
            <div style={{ marginTop: "var(--space-1)", color: "var(--color-text-muted)" }}>
              {ev.location}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrainingPlanPage() {
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [daysBack, setDaysBack] = useState(14);
  const [daysForward, setDaysForward] = useState(30);

  useEffect(() => {
    async function fetchEvents() {
      setIsLoading(true);
      setError("");
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(
          `${apiBase}/api/training-plan/events?days_back=${daysBack}&days_forward=${daysForward}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: TrainingEvent[] = await res.json();
        setEvents(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load training plan.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchEvents();
  }, [daysBack, daysForward]);

  const grouped = groupByDate(events);
  const sortedDates = Object.keys(grouped).sort();

  const todayIdx = sortedDates.findIndex(isToday);
  const todayEvents = grouped[new Date().toISOString().slice(0, 10)] ?? [];

  // Summary stats
  const upcomingCount = events.filter((e) => !isPast(e.start.slice(0, 10))).length;
  const pastCount = events.filter((e) => isPast(e.start.slice(0, 10))).length;
  const runCount = events.filter((e) => e.event_type === "run").length;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Training Plan</h2>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Show:</span>
            <select
              id="plan-days-back"
              style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)", fontSize: "var(--text-xs)", padding: "4px 8px" }}
              value={daysBack}
              onChange={(e) => setDaysBack(Number(e.target.value))}
            >
              <option value={7}>7d back</option>
              <option value={14}>14d back</option>
              <option value={30}>30d back</option>
            </select>
            <select
              id="plan-days-forward"
              style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", color: "var(--color-text-primary)", fontSize: "var(--text-xs)", padding: "4px 8px" }}
              value={daysForward}
              onChange={(e) => setDaysForward(Number(e.target.value))}
            >
              <option value={14}>14d ahead</option>
              <option value={30}>30d ahead</option>
              <option value={60}>60d ahead</option>
            </select>
          </div>
        </header>

        <div className="page-body">
          {/* Summary Row */}
          <div className="metrics-grid" style={{ marginBottom: "var(--space-4)" }}>
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Today's Sessions</span>
              </div>
              <div className="metric-value">{todayEvents.length}</div>
              <div className="metric-change neutral">
                {todayEvents.length === 0
                  ? "Rest day"
                  : todayEvents.map((e) => e.summary).join(", ")}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Upcoming Sessions</span>
              </div>
              <div className="metric-value">{upcomingCount}</div>
              <div className="metric-change positive">Next {daysForward} days</div>
            </div>
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Past (in view)</span>
              </div>
              <div className="metric-value">{pastCount}</div>
              <div className="metric-change neutral">Last {daysBack} days</div>
            </div>
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Run Sessions</span>
              </div>
              <div className="metric-value">{runCount}</div>
              <div className="metric-change neutral">In current view</div>
            </div>
          </div>

          {/* Timeline */}
          <div className="card animate-fade-in">
            <div className="card-header">
              <h3 className="card-title">Schedule Timeline</h3>
            </div>

            {isLoading && (
              <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--color-text-muted)" }}>
                Loading training plan...
              </div>
            )}

            {error && (
              <div style={{ padding: "var(--space-4)", color: "#ef4444", fontSize: "var(--text-sm)" }}>
                Error: {error}
              </div>
            )}

            {!isLoading && !error && sortedDates.length === 0 && (
              <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--color-text-muted)" }}>
                No training events found in this window.
              </div>
            )}

            {!isLoading && !error && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
                {sortedDates.map((dateStr, idx) => {
                  const dayEvents = grouped[dateStr];
                  const today = isToday(dateStr);
                  const past = isPast(dateStr);

                  return (
                    <div
                      key={dateStr}
                      id={today ? "plan-today" : undefined}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        gap: "var(--space-3)",
                        padding: "var(--space-3) 0",
                        borderBottom: idx < sortedDates.length - 1 ? "1px solid var(--border-color)" : "none",
                        opacity: past ? 0.55 : 1,
                      }}
                    >
                      {/* Date column */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", paddingTop: "2px" }}>
                        <span
                          style={{
                            fontSize: "var(--text-sm)",
                            fontWeight: "var(--weight-semibold)",
                            color: today ? "var(--color-accent-cyan)" : past ? "var(--color-text-muted)" : "var(--color-text-primary)",
                          }}
                        >
                          {formatDate(dateStr)}
                        </span>
                        {today && (
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-accent-cyan)", background: "rgba(34,211,238,0.1)", borderRadius: "var(--radius-sm)", padding: "1px 6px", marginTop: "4px", fontWeight: "var(--weight-semibold)" }}>
                            TODAY
                          </span>
                        )}
                      </div>

                      {/* Events column */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                        {dayEvents.map((ev) => (
                          <EventCard key={ev.uid} ev={ev} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
