"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import { getSportVisual } from "@/components/SportActivityIcon";

interface TrainingEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  location: string;
  event_type: "run" | "ride" | "strength" | "swim" | "yoga" | "pilates" | "race" | "other";
  is_all_day: boolean;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDays(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const firstCell = new Date(firstOfMonth);
  firstCell.setDate(firstOfMonth.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  });
}

function daysBetween(first: Date, second: Date): number {
  return Math.round((second.getTime() - first.getTime()) / 86_400_000);
}

function formatTime(iso: string, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function mapEmbedUrl(location: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(location)}&output=embed`;
}

function mapSearchUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

export default function TrainingPlanPage() {
  const today = useMemo(() => new Date(), []);
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const days = useMemo(() => calendarDays(anchor), [anchor]);
  const firstDate = days[0];
  const lastDate = days[days.length - 1];
  const todayKey = localDateKey(today);

  useEffect(() => {
    async function fetchCalendarData() {
      setIsLoading(true);
      setError("");
      const daysBack = Math.max(0, daysBetween(firstDate, today));
      const daysForward = Math.max(0, daysBetween(today, lastDate));
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

      try {
        const eventsResponse = await fetch(`${apiBase}/api/training-plan/events?days_back=${daysBack}&days_forward=${daysForward}`);
        if (!eventsResponse.ok) throw new Error(`HTTP ${eventsResponse.status}`);
        const eventData: TrainingEvent[] = await eventsResponse.json();
        setEvents(eventData);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load calendar.");
      } finally {
        setIsLoading(false);
      }
    }
    void fetchCalendarData();
  }, [firstDate, lastDate]);

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, TrainingEvent[]> = {};
    for (const event of events) {
      const key = event.start.slice(0, 10);
      (grouped[key] ??= []).push(event);
    }
    return grouped;
  }, [events]);
  const selectedPlans = eventsByDate[selectedDate] ?? [];
  const monthLabel = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const moveMonth = (offset: number) => {
    setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };
  const returnToToday = () => {
    setAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <PageTitle>Training Calendar</PageTitle>
          <div className="plan-calendar-controls">
            <button className="btn btn-secondary btn-sm" type="button" onClick={returnToToday}>Today</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">‹</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => moveMonth(1)} aria-label="Next month">›</button>
          </div>
        </header>

        <div className="page-body">
          <div className="plan-calendar-heading">
            <h1>{monthLabel}</h1>
          </div>

          {error && <div className="plan-calendar-message error">Calendar unavailable: {error}</div>}
          {isLoading && (
            <div className="plan-calendar-layout plan-calendar-skeleton" aria-label="Loading calendar" aria-busy="true">
              <section className="plan-calendar-grid">
                <div className="plan-calendar-weekdays">
                  {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="plan-calendar-days">
                  {days.map((date) => (
                    <div className="plan-calendar-day" key={localDateKey(date)}>
                      <span className="skeleton plan-calendar-skeleton-date" />
                      <span className="skeleton plan-calendar-skeleton-entry" />
                    </div>
                  ))}
                </div>
              </section>
              <aside className="plan-day-detail hover-card">
                <div className="skeleton plan-calendar-skeleton-label" />
                <div className="skeleton plan-calendar-skeleton-title" />
                <div className="skeleton plan-calendar-skeleton-line" />
              </aside>
            </div>
          )}

          {!isLoading && !error && (
            <div className="plan-calendar-layout">
              <section className="plan-calendar-grid" aria-label={`${monthLabel} training calendar`}>
                <div className="plan-calendar-weekdays">
                  {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="plan-calendar-days">
                  {days.map((date) => {
                    const dateKey = localDateKey(date);
                    const plans = eventsByDate[dateKey] ?? [];
                    const inMonth = date.getMonth() === anchor.getMonth();
                    const isPast = dateKey < todayKey;
                    const isToday = dateKey === todayKey;
                    const isSelected = dateKey === selectedDate;
                    return (
                      <button
                        key={dateKey}
                        type="button"
                        className={`plan-calendar-day${inMonth ? "" : " is-outside"}${isPast ? " is-past" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedDate(dateKey)}
                      >
                        <span className="plan-calendar-date">{date.getDate()}</span>
                        <span className="plan-calendar-entries">
                          {plans.slice(0, 2).map((event) => {
                            const sportVisual = getSportVisual(event.event_type);
                            return (
                              <span
                                className="plan-calendar-entry planned"
                                key={event.uid}
                                style={{ background: `radial-gradient(circle at 0 0, ${sportVisual.background}, transparent 90%), var(--color-surface-secondary)`, borderColor: sportVisual.background }}
                              >
                                <small style={{ color: sportVisual.color }}>{formatTime(event.start, event.is_all_day)}</small>
                                <strong>{event.summary}</strong>
                              </span>
                            );
                          })}
                          {plans.length > 2 && <span className="plan-calendar-more">+{plans.length - 2} more</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <aside className="plan-day-detail">
                <span className="plan-day-detail-label">Selected day</span>
                <h3>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</h3>
                {selectedPlans.length === 0 && <p className="plan-day-empty">No planned workout.</p>}
                {selectedPlans.map((event) => (
                  <div className="plan-day-item planned" key={event.uid}>
                    <span>{formatTime(event.start, event.is_all_day)}</span>
                    <strong>{event.summary}</strong>
                    {event.location && (
                      <div className="plan-location">
                        <small>{event.location}</small>
                        <iframe title={`Map for ${event.location}`} src={mapEmbedUrl(event.location)} loading="lazy" referrerPolicy="no-referrer" />
                      </div>
                    )}
                    {event.description && <div className="plan-workout-note"><span>Workout notes</span><p>{event.description}</p></div>}
                  </div>
                ))}
              </aside>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
