"use client";

import React, { useState, useEffect, useMemo } from "react";
import type { ActivitySummary } from "@/lib/types";

export type SportColorCategory = "strength" | "trail" | "run" | "cycle" | "swim" | "other";

interface HeatmapDay {
  dateStr: string;
  dayOfWeek: number; // 0=Mon, 6=Sun
  weekIndex: number; // 0..51
  load: number;
  activityCount: number;
  sports: SportColorCategory[];
  distanceKm: number;
  durationMins: number;
}

interface TrainingHeatmapPanelProps {
  activities?: ActivitySummary[];
}

interface BackendLoadItem {
  date: string;
  total_load: number;
  activity_count: number;
  sports?: string[];
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const SPORT_COLORS: Record<SportColorCategory, string> = {
  strength: "#FF4D62",
  trail: "#2D9BF0",
  run: "#21E6A5",
  cycle: "#F0D348",
  swim: "#00C2FF",
  other: "#A0AEC0",
};

function normalizeSportCategory(sportStr: string, titleStr: string = ""): SportColorCategory {
  const s = (sportStr || "").toLowerCase();
  const t = (titleStr || "").toLowerCase();
  if (s.includes("strength") || s.includes("gym") || s.includes("weights") || t.includes("strength") || t.includes("gym")) return "strength";
  if (s.includes("trail") || s.includes("hike") || s.includes("climb") || t.includes("trail") || t.includes("hike")) return "trail";
  if (s.includes("ride") || s.includes("cycle") || s.includes("bike") || /\b(?:ride|cycling|cycle|bike)\b/.test(t)) return "cycle";
  if (s.includes("swim") || s.includes("pool") || t.includes("swim")) return "swim";
  if (s.includes("run") || s.includes("track") || t.includes("run")) return "run";
  return "other";
}

export default function TrainingHeatmapPanel({ activities = [] }: TrainingHeatmapPanelProps) {
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [yearlyLoadData, setYearlyLoadData] = useState<BackendLoadItem[]>([]);

  // Fetch authentic historical training load records directly from backend API
  useEffect(() => {
    async function fetchYearlyLoad() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiBase}/api/dashboard/training-load?days=365`);
        if (res.ok) {
          const json = await res.json();
          setYearlyLoadData(json);
        }
      } catch (err) {
        console.error("Failed to fetch training load history:", err);
      }
    }
    fetchYearlyLoad();
  }, []);

  // Map backend load items by YYYY-MM-DD
  const backendLoadMap = useMemo(() => {
    const map: Record<string, BackendLoadItem> = {};
    for (const item of yearlyLoadData) {
      if (item.date) map[item.date] = item;
    }
    return map;
  }, [yearlyLoadData]);

  // Map 7-day activity array by YYYY-MM-DD for sport category precision
  const activityMap = useMemo(() => {
    const map: Record<string, ActivitySummary[]> = {};
    for (const act of activities) {
      if (!act.start_time) continue;
      const dateKey = act.start_time.split("T")[0];
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(act);
    }
    return map;
  }, [activities]);

  // Generate 52 calendar weeks (Monday -> Sunday) ending with current week
  const heatmapData = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const currentDayOfWeek = (today.getDay() + 6) % 7; // Convert Sun=0 to Mon=0 (Wed = 2)

    // Calculate Monday of current week
    const currentWeekMon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - currentDayOfWeek);

    // Start date is 51 weeks before current week Monday (52 weeks total)
    const startDate = new Date(currentWeekMon.getFullYear(), currentWeekMon.getMonth(), currentWeekMon.getDate() - 51 * 7);

    const days: HeatmapDay[] = [];

    for (let wIdx = 0; wIdx < 52; wIdx++) {
      for (let dIdx = 0; dIdx < 7; dIdx++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + (wIdx * 7 + dIdx));
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const dayNum = String(d.getDate()).padStart(2, "0");
        const dateStr = `${year}-${month}-${dayNum}`;

        // Is this day in the future (after today)?
        const isFuture = d.getTime() > today.getTime();

        const dayActs = activityMap[dateStr] || [];
        const realLoadItem = backendLoadMap[dateStr];

        let load = 0;
        let activityCount = 0;
        const sportsSet = new Set<SportColorCategory>();

        if (!isFuture) {
          if (dayActs.length > 0) {
            load = dayActs.reduce((sum, a) => sum + (a.training_load_vendor || 0), 0);
            activityCount = dayActs.length;
            for (const a of dayActs) {
              sportsSet.add(normalizeSportCategory(a.sport, a.title || ""));
            }
          } else if (realLoadItem) {
            load = Math.round(realLoadItem.total_load || 0);
            activityCount = realLoadItem.activity_count || 1;
            const rawSports = realLoadItem.sports || [];
            for (const s of rawSports) {
              sportsSet.add(normalizeSportCategory(s));
            }
          }
        }

        const sports = Array.from(sportsSet);
        const totalDistM = dayActs.reduce((sum, a) => sum + (a.distance_m || 0), 0);
        const totalDurS = dayActs.reduce((sum, a) => sum + (a.elapsed_time_s || 0), 0);

        days.push({
          dateStr,
          dayOfWeek: dIdx,
          weekIndex: wIdx,
          load,
          activityCount,
          sports,
          distanceKm: Math.round((totalDistM / 1000) * 10) / 10,
          durationMins: Math.round(totalDurS / 60),
        });
      }
    }

    return days;
  }, [activityMap, backendLoadMap]);

  const activeDays = useMemo(() => heatmapData.filter((d) => d.load > 0).length, [heatmapData]);
  const totalLoad = useMemo(() => heatmapData.reduce((sum, d) => sum + d.load, 0), [heatmapData]);

  // Months label calculation based on 52 week span
  const months = useMemo(() => {
    const labels = [];
    const today = new Date();
    for (let i = 12; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      labels.push(d.toLocaleDateString("en-US", { month: "short" }));
    }
    return labels;
  }, []);

  // Compute cell background color / multi-sport conic gradient pie slice (Inspired by CorosLink)
  const getCellBackground = (day: HeatmapDay) => {
    if (day.load === 0 || day.sports.length === 0) return "rgba(255, 255, 255, 0.04)";

    // Single sport -> solid sport color with intensity
    if (day.sports.length === 1) {
      return SPORT_COLORS[day.sports[0]] || "#21E6A5";
    }

    // Multiple sports on the same day -> equal pie slice conic gradient (CorosLink style!)
    const sliceAngle = 360 / day.sports.length;
    const stops = day.sports.map((cat, idx) => {
      const start = idx * sliceAngle;
      const end = (idx + 1) * sliceAngle;
      const color = SPORT_COLORS[cat] || "#21E6A5";
      return `${color} ${start}deg ${end}deg`;
    });

    return `conic-gradient(${stops.join(", ")})`;
  };

  return (
    <div
      className="hover-card"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-6)",
        marginBottom: "var(--space-6)",
      }}
    >
      {/* Header Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            TRAINING ACTIVITY
          </span>
          <h3 style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text-primary)", marginTop: "2px" }}>
            Load heatmap
          </h3>
        </div>
      </div>

      {/* Month Labels Row */}
      <div style={{ display: "flex", marginLeft: "28px", justifyContent: "space-between", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>
        {months.map((m, idx) => (
          <span key={idx}>{m}</span>
        ))}
      </div>

      {/* Heatmap 7x52 Grid Container */}
      <div style={{ display: "flex", gap: "6px", overflowX: "auto", padding: "8px 0" }}>
        {/* Weekday Labels Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "3px", justifyContent: "space-around", fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", width: "16px", flexShrink: 0 }}>
          {WEEKDAYS.map((w, idx) => (
            <span key={idx} style={{ height: "11px", lineHeight: "11px" }}>{w}</span>
          ))}
        </div>

        {/* 52 Week Columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(52, 1fr)", gap: "3px", flex: 1 }}>
          {Array.from({ length: 52 }, (_, wIdx) => (
            <div key={wIdx} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {Array.from({ length: 7 }, (_, dIdx) => {
                const item = heatmapData.find((d) => d.weekIndex === wIdx && d.dayOfWeek === dIdx);
                if (!item) return <span key={dIdx} style={{ width: "11px", height: "11px", borderRadius: "2px", background: "transparent" }} />;

                return (
                  <span
                    key={dIdx}
                    onMouseEnter={() => setHoveredDay(item)}
                    onMouseLeave={() => setHoveredDay(null)}
                    style={{
                      width: "11px",
                      height: "11px",
                      borderRadius: "3px",
                      background: getCellBackground(item),
                      cursor: "pointer",
                      transition: "transform 150ms ease, box-shadow 150ms ease",
                      transform: hoveredDay?.dateStr === item.dateStr ? "scale(1.35)" : "scale(1)",
                      boxShadow: hoveredDay?.dateStr === item.dateStr ? "0 0 8px rgba(33, 230, 165, 0.9)" : "none",
                      zIndex: hoveredDay?.dateStr === item.dateStr ? 10 : 1,
                    }}
                    title={`${item.dateStr}: ${item.load > 0 ? `${item.load} load (${item.sports.join(", ")})` : "Rest day"}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend & Summary Statistics Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-4)", flexWrap: "wrap", gap: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "var(--space-4)" }}>
        {/* Sport Categories Legend */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "11px", color: "var(--color-text-secondary)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FF4D62" }} /> Strength / Gym
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#00C2FF" }} /> Swimming
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#21E6A5" }} /> Running
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#F0D348" }} /> Cycling
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#A0AEC0" }} /> Other
          </span>
        </div>

        {/* Stats Summary Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 12px", fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {activeDays} active days
          </span>
          <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 12px", fontSize: "12px", fontWeight: 700, color: "var(--color-accent-primary)" }}>
            {activeDays > 0 ? "Active streak" : "Rest day"}
          </span>
          <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 12px", fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {totalLoad.toLocaleString()} total load
          </span>
        </div>
      </div>
    </div>
  );
}
