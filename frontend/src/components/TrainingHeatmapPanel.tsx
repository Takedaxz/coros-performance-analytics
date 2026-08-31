"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import type { ActivitySummary } from "@/lib/types";

export type SportColorCategory = "strength" | "trail" | "hike" | "run" | "cycle" | "swim" | "other";

interface HeatmapDay {
  dateStr: string;
  dayOfWeek: number; // 0=Mon, 6=Sun
  weekIndex: number; // 0..51
  load: number;
  activityCount: number;
  sports: SportColorCategory[];
  sportLoads?: Partial<Record<SportColorCategory, number>>;
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
  total_distance_m?: number;
  total_duration_s?: number;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const SPORT_COLORS: Record<SportColorCategory, string> = {
  strength: "#FF4D62",
  trail: "#2D9BF0",
  hike: "#A0AEC0",
  run: "#21E6A5",
  cycle: "#F0D348",
  swim: "#00C2FF",
  other: "#A0AEC0",
};

const SPORT_LABELS: Record<SportColorCategory, string> = {
  strength: "Strength",
  trail: "Trail Run",
  hike: "Hike",
  run: "Running",
  cycle: "Cycling",
  swim: "Swimming",
  other: "Other",
};

function formatDateNice(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMinsToHours(mins: number): string {
  if (mins <= 0) return "0m";
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs > 0 && remMins > 0) return `${hrs}h ${remMins}m`;
  if (hrs > 0) return `${hrs}h`;
  return `${remMins}m`;
}

function normalizeSportCategory(sportStr: string, titleStr: string = ""): SportColorCategory {
  const s = (sportStr || "").toLowerCase();
  const t = (titleStr || "").toLowerCase();
  if (s.includes("strength") || s.includes("gym") || s.includes("weights") || t.includes("strength") || t.includes("gym")) return "strength";
  if (s.includes("hike") || t.includes("hike")) return "hike";
  if (s.includes("trail") || s.includes("climb") || t.includes("trail")) return "trail";
  if (s.includes("ride") || s.includes("cycle") || s.includes("bike") || /\b(?:ride|cycling|cycle|bike)\b/.test(t)) return "cycle";
  if (s.includes("swim") || s.includes("pool") || t.includes("swim")) return "swim";
  if (s.includes("run") || s.includes("track") || t.includes("run")) return "run";
  return "other";
}

interface TooltipPos {
  x: number;
  y: number;
  isLeftEdge: boolean;
  isRightEdge: boolean;
  isTopEdge: boolean;
  containerWidth: number;
}

export default function TrainingHeatmapPanel({ activities = [] }: TrainingHeatmapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapScrollRef = useRef<HTMLDivElement>(null);
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);
  const [yearlyLoadData, setYearlyLoadData] = useState<BackendLoadItem[]>([]);

  const handleCellHover = (item: HeatmapDay, e: React.MouseEvent<HTMLSpanElement>) => {
    setHoveredDay(item);
    if (containerRef.current) {
      const squareRect = e.currentTarget.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;

      const cellCenterX = squareRect.left - containerRect.left + squareRect.width / 2;
      const cellTopY = squareRect.top - containerRect.top;
      const cellBottomY = squareRect.bottom - containerRect.top;

      // Detect edge boundaries to prevent tooltip clipping
      const isLeftEdge = cellCenterX < 130;
      const isRightEdge = cellCenterX > containerWidth - 130;
      const isTopEdge = cellTopY < 110;

      setTooltipPos({
        x: cellCenterX,
        y: isTopEdge ? cellBottomY + 8 : cellTopY - 8,
        isLeftEdge,
        isRightEdge,
        isTopEdge,
        containerWidth,
      });
    }
  };

  const handleCellLeave = () => {
    setHoveredDay(null);
    setTooltipPos(null);
  };

  // Fetch 1-year aggregated load data from backend training load endpoint
  useEffect(() => {
    async function loadYearlyData() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiBase}/api/dashboard/training-load?days=365`);
        if (res.ok) {
          const data = await res.json();
          setYearlyLoadData(Array.isArray(data) ? data : data.days || []);
        }
      } catch (err) {
        console.warn("Failed to fetch yearly training load history:", err);
      }
    }
    loadYearlyData();
  }, []);

  // Map frontend activities into date lookup
  const activityMap = useMemo(() => {
    const map: Record<string, ActivitySummary[]> = {};
    for (const a of activities) {
      if (!a.start_time) continue;
      const dStr = a.start_time.split("T")[0];
      if (!map[dStr]) map[dStr] = [];
      map[dStr].push(a);
    }
    return map;
  }, [activities]);

  // Map backend fallback load items into date lookup
  const backendLoadMap = useMemo(() => {
    const map: Record<string, BackendLoadItem> = {};
    for (const item of yearlyLoadData) {
      if (item.date) map[item.date] = item;
    }
    return map;
  }, [yearlyLoadData]);

  // Compute 52-week 7x52 grid array ending today
  const heatmapData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayOfWeekToday = today.getDay(); // 0=Sun, 6=Sat
    const totalDaysToDisplay = 51 * 7 + (dayOfWeekToday + 1);

    const startDate = new Date(today);
    startDate.setDate(today.getDate() - (totalDaysToDisplay - 1));

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
        let distM = 0;
        let durS = 0;
        const sportsSet = new Set<SportColorCategory>();
        const sportLoads: Partial<Record<SportColorCategory, number>> = {};

        if (!isFuture) {
          if (dayActs.length > 0) {
            load = dayActs.reduce((sum, a) => sum + (a.training_load_vendor || 0), 0);
            activityCount = dayActs.length;
            distM = dayActs.reduce((sum, a) => sum + (a.distance_m || 0), 0);
            durS = dayActs.reduce((sum, a) => sum + (a.elapsed_time_s || 0), 0);
            for (const a of dayActs) {
              const cat = normalizeSportCategory(a.sport, a.title || "");
              sportsSet.add(cat);
              const actLoad = a.training_load_vendor || 0;
              sportLoads[cat] = (sportLoads[cat] || 0) + actLoad;
            }
          } else if (realLoadItem) {
            load = Math.round(realLoadItem.total_load || 0);
            activityCount = realLoadItem.activity_count || 1;
            distM = realLoadItem.total_distance_m || 0;
            durS = realLoadItem.total_duration_s || 0;
            const rawSports = realLoadItem.sports || [];
            const perSportLoad = rawSports.length > 0 ? load / rawSports.length : load;
            for (const s of rawSports) {
              const cat = normalizeSportCategory(s);
              sportsSet.add(cat);
              sportLoads[cat] = (sportLoads[cat] || 0) + perSportLoad;
            }
          }
        }

        const sports = Array.from(sportsSet);

        days.push({
          dateStr,
          dayOfWeek: dIdx,
          weekIndex: wIdx,
          load,
          activityCount,
          sports,
          sportLoads,
          distanceKm: Math.round((distM / 1000) * 10) / 10,
          durationMins: Math.round(durS / 60),
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

  useEffect(() => {
    if (heatmapScrollRef.current) {
      heatmapScrollRef.current.scrollLeft = heatmapScrollRef.current.scrollWidth;
    }
  }, [heatmapData, months]);

  // Compute peak (maximum) daily load independently for each sport category
  const maxLoadPerSport = useMemo(() => {
    const maxes: Record<SportColorCategory, number> = {
      strength: 40,
      trail: 40,
      hike: 40,
      run: 40,
      cycle: 40,
      swim: 40,
      other: 40,
    };

    for (const day of heatmapData) {
      if (!day.sportLoads) continue;
      for (const [catStr, loadVal] of Object.entries(day.sportLoads)) {
        const cat = catStr as SportColorCategory;
        if (loadVal && loadVal > (maxes[cat] || 0)) {
          maxes[cat] = loadVal;
        }
      }
    }

    return maxes;
  }, [heatmapData]);

  // Helper to apply dynamic alpha to hex colors based on sport-specific max load
  const getScaledColor = (cat: SportColorCategory, sportLoad: number) => {
    const hexColor = SPORT_COLORS[cat] || "#21E6A5";
    const maxSportLoad = maxLoadPerSport[cat] || 40;
    const h = hexColor.replace("#", "");
    if (h.length === 6) {
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      // Scale load relative to max load of this specific sport category
      // alpha ranges from 0.28 (pale/faded for low load) to 1.0 (full vibrant saturation for peak load)
      const ratio = Math.min(1, Math.max(0, sportLoad / maxSportLoad));
      const alpha = 0.28 + 0.72 * Math.pow(ratio, 0.6);
      return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }
    return hexColor;
  };

  // Compute cell background color / multi-sport conic gradient pie slice with per-sport intensity scaling
  const getCellBackground = (day: HeatmapDay) => {
    if (day.load === 0 || day.sports.length === 0) return "var(--color-overlay-subtle)";

    // Single sport -> sport color with per-sport load intensity
    if (day.sports.length === 1) {
      const cat = day.sports[0];
      const catLoad = day.sportLoads?.[cat] ?? day.load;
      return getScaledColor(cat, catLoad);
    }

    // Multiple sports on the same day -> equal pie slice conic gradient with per-sport load intensity
    const sliceAngle = 360 / day.sports.length;
    const stops = day.sports.map((cat, idx) => {
      const start = idx * sliceAngle;
      const end = (idx + 1) * sliceAngle;
      const catLoad = day.sportLoads?.[cat] ?? (day.load / day.sports.length);
      const color = getScaledColor(cat, catLoad);
      return `${color} ${start}deg ${end}deg`;
    });

    return `conic-gradient(${stops.join(", ")})`;
  };

  return (
    <div
      ref={containerRef}
      className="hover-card"
      style={{
        position: "relative",
        background: "var(--color-bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-6)",
        marginBottom: "var(--space-6)",
      }}
    >
      {/* Custom Popup Tooltip */}
      {hoveredDay && tooltipPos && (() => {
        let transformX = "-50%";
        let leftPos = `${tooltipPos.x}px`;

        if (tooltipPos.isRightEdge) {
          transformX = "-100%";
          leftPos = `${Math.min(tooltipPos.containerWidth - 16, tooltipPos.x + 12)}px`;
        } else if (tooltipPos.isLeftEdge) {
          transformX = "0%";
          leftPos = `${Math.max(16, tooltipPos.x - 12)}px`;
        }

        const transformY = tooltipPos.isTopEdge ? "0%" : "-100%";

        return (
          <div
            key={hoveredDay.dateStr}
            style={{
              position: "absolute",
              left: leftPos,
              top: `${tooltipPos.y}px`,
              transform: `translate(${transformX}, ${transformY})`,
              pointerEvents: "none",
              zIndex: 50,
            }}
          >
            <div
              style={{
                background: "var(--color-surface-elevated, #181B22)",
                border: "1px solid var(--border-color, rgba(255, 255, 255, 0.15))",
                borderRadius: "10px",
                padding: "10px 14px",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5), 0 0 16px rgba(33, 230, 165, 0.15)",
                minWidth: "180px",
                maxWidth: "240px",
                whiteSpace: "nowrap",
                backdropFilter: "blur(12px)",
                animation: "tooltip-pop-in 120ms cubic-bezier(0.16, 1, 0.3, 1)",
                transformOrigin: tooltipPos.isRightEdge
                  ? "bottom right"
                  : tooltipPos.isLeftEdge
                  ? "bottom left"
                  : "bottom center",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.02em", marginBottom: "4px" }}>
                {formatDateNice(hoveredDay.dateStr)}
              </div>

              {hoveredDay.load > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                    <span style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-accent-primary, #21E6A5)", lineHeight: 1 }}>
                      {hoveredDay.load}
                    </span>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Training Load
                    </span>
                  </div>

                  {hoveredDay.sports.length > 0 && (
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                      {hoveredDay.sports.map((sport) => (
                        <span
                          key={sport}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            fontSize: "10px",
                            fontWeight: 700,
                            background: `${SPORT_COLORS[sport]}1A`,
                            color: SPORT_COLORS[sport],
                            border: `1px solid ${SPORT_COLORS[sport]}40`,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: SPORT_COLORS[sport] }} />
                          {SPORT_LABELS[sport] || sport}
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "11px", color: "var(--color-text-secondary)", paddingTop: "6px", borderTop: "1px solid var(--border-color)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span>Distance:</span>
                      <strong style={{ color: "var(--color-text-primary)" }}>{hoveredDay.distanceKm > 0 ? `${hoveredDay.distanceKm} km` : "—"}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                      <span>Duration:</span>
                      <strong style={{ color: "var(--color-text-primary)" }}>{hoveredDay.durationMins > 0 ? formatMinsToHours(hoveredDay.durationMins) : "—"}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>
                  Rest day (No load)
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Header Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            TRAINING ACTIVITY
          </span>
          <h3 style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text-primary)", marginTop: "2px" }}>
            Load log
          </h3>
        </div>
      </div>

      {/* One timeline keeps month labels and cells aligned during drag/swipe. */}
      <div ref={heatmapScrollRef} style={{ overflowX: "auto", overflowY: "hidden", padding: "8px 0", scrollbarGutter: "stable" }}>
        <div style={{ minWidth: "725px", width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr) 16px", gap: "6px", marginBottom: "6px", fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>
            <span aria-hidden="true" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(13, minmax(0, 1fr))", gap: "3px" }}>
              {months.map((m, idx) => (
                <span key={idx}>{m}</span>
              ))}
            </div>
            <span aria-hidden="true" />
          </div>

          <div style={{ display: "flex", gap: "6px" }}>
            {/* Weekday Labels Column */}
            <div className="heatmap-weekday-labels" style={{ display: "flex", flexDirection: "column", gap: "3px", justifyContent: "space-around", fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", width: "16px", flexShrink: 0 }}>
              {WEEKDAYS.map((w, idx) => (
                <span key={idx} style={{ height: "11px", lineHeight: "11px" }}>{w}</span>
              ))}
            </div>

            {/* 52 Week Columns */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(52, minmax(11px, 1fr))", gap: "3px", flex: 1 }}>
              {Array.from({ length: 52 }, (_, wIdx) => (
                <div key={wIdx} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {Array.from({ length: 7 }, (_, dIdx) => {
                    const item = heatmapData.find((d) => d.weekIndex === wIdx && d.dayOfWeek === dIdx);
                    if (!item) return <span key={dIdx} style={{ width: "11px", height: "11px", borderRadius: "2px", background: "transparent" }} />;

                    return (
                      <span
                        key={dIdx}
                        onMouseEnter={(e) => handleCellHover(item, e)}
                        onMouseLeave={handleCellLeave}
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
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            <div aria-hidden="true" className="heatmap-weekday-labels" style={{ display: "flex", flexDirection: "column", gap: "3px", justifyContent: "space-around", fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", width: "16px", flexShrink: 0 }}>
              {WEEKDAYS.map((w, idx) => (
                <span key={idx} style={{ height: "11px", lineHeight: "11px" }}>{w}</span>
              ))}
            </div>
          </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "nowrap", maxWidth: "100%", whiteSpace: "nowrap" }}>
          <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 6px", fontSize: "10px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
            {activeDays} active days
          </span>
          <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 6px", fontSize: "10px", fontWeight: 700, color: "var(--color-accent-primary)", whiteSpace: "nowrap" }}>
            {activeDays > 0 ? "Active streak" : "Rest day"}
          </span>
          <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 6px", fontSize: "10px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
            {totalLoad.toLocaleString()} total load
          </span>
        </div>
      </div>
    </div>
  );
}
