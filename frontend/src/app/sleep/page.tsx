"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import MetricCard from "@/components/MetricCard";
import SingleSelect from "@/components/SingleSelect";
import { FEELING_OPTIONS, type DailyFeeling, type FeelingLevel } from "@/components/DailyFeelingCheckIn";
import { ChartInsightPill, computeSeriesStats, formatSleepHours } from "@/components/ChartInsightPill";
import type { HealthDay, SleepSummary } from "@/lib/types";

interface SleepTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  fill?: string;
  payload?: { total: number };
}

interface GenericTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  fill?: string;
  stroke?: string;
}

const STAGE_COLORS: Record<string, string> = {
  Deep: "#21E6A5",
  REM: "#2D9BF0",
  Light: "#8DABC2",
  Awake: "#CBD5E1",
  Nap: "#8B7CC0",
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const FEELING_COLORS: Record<FeelingLevel, string> = {
  very_low: "#d96c78",
  low: "#db9a56",
  okay: "#c8b35e",
  good: "#72b98a",
  great: "#6bb7cf",
};

const FEELING_NAMES: Record<FeelingLevel, string> = {
  very_low: "Very Low",
  low: "Low",
  okay: "Okay",
  good: "Good",
  great: "Great",
};

interface HeatmapFeelingDay {
  dateStr: string;
  dayOfWeek: number; // 0=Mon, 6=Sun
  weekIndex: number; // 0..51
  isFuture: boolean;
  entry?: DailyFeeling;
}

interface TooltipPos {
  x: number;
  y: number;
  isLeftEdge: boolean;
  isRightEdge: boolean;
  isTopEdge: boolean;
  containerWidth: number;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatChartAxisDate(dateStr?: string | number): string {
  if (!dateStr) return "";
  const parts = String(dateStr).split("-");
  if (parts.length === 3) {
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (!isNaN(month) && !isNaN(day) && month >= 1 && month <= 12) {
      return `${day} ${SHORT_MONTHS[month - 1]}`;
    }
  } else if (parts.length === 2) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    if (!isNaN(month) && !isNaN(day) && month >= 1 && month <= 12) {
      return `${day} ${SHORT_MONTHS[month - 1]}`;
    }
  }
  return String(dateStr);
}

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

function formatFeelingDateTitle(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}


function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return wholeHours > 0 ? `${wholeHours}h ${minutes}m` : `${minutes}m`;
}

function SleepStageTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: SleepTooltipEntry[];
}) {
  if (!active || !payload?.length) return null;
  const total = payload[0].payload?.total ?? 0;

  return (
    <div style={{ padding: "12px 14px", borderRadius: "16px", background: "var(--color-popover)", border: "1px solid var(--border-color)", color: "var(--color-text-primary)", boxShadow: "var(--shadow-md)" }}>
      <strong style={{ display: "block", marginBottom: "8px", color: "var(--color-text-secondary)", fontSize: "12px" }}>{label ? formatChartAxisDate(label) : ""}</strong>
      {payload.map((entry) => {
        const stageColor = entry.color || entry.fill || STAGE_COLORS[entry.name ?? ""] || "var(--color-accent-primary)";
        return (
          <div key={entry.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "18px", marginTop: "5px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <i
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: stageColor,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {entry.name}
            </span>
            <strong>{formatHoursMinutes(Number(entry.value))}</strong>
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", marginTop: "10px", paddingTop: "9px", borderTop: "1px solid var(--border-color)" }}>
        <strong>Total</strong>
        <strong>{formatHoursMinutes(total)}</strong>
      </div>
    </div>
  );
}

function ChartLegendTooltip({
  active,
  label,
  payload,
  unit = "",
}: {
  active?: boolean;
  label?: string;
  payload?: GenericTooltipEntry[];
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "14px",
        background: "var(--color-popover)",
        border: "1px solid var(--border-color)",
        color: "var(--color-text-primary)",
        boxShadow: "var(--shadow-md)",
        minWidth: "160px",
      }}
    >
      <strong style={{ display: "block", marginBottom: "8px", color: "var(--color-text-secondary)", fontSize: "12px" }}>
        {label ? formatChartAxisDate(label) : ""}
      </strong>
      {payload.map((entry, idx) => {
        const itemColor = entry.stroke || entry.color || entry.fill || "var(--color-accent-primary)";
        const val = typeof entry.value === "number" ? Math.round(entry.value).toLocaleString() : entry.value;
        return (
          <div
            key={entry.name || idx}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              marginTop: idx === 0 ? 0 : "5px",
              fontSize: "13px",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
              <i
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: itemColor,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {entry.name}
            </span>
            <strong>
              {val} {unit}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export default function SleepPage() {
  const [health, setHealth] = useState<HealthDay[]>([]);
  const [sleep, setSleep] = useState<SleepSummary[]>([]);
  const [feelings, setFeelings] = useState<DailyFeeling[]>([]);
  const [editingFeelingDate, setEditingFeelingDate] = useState<string | null>(null);
  const [draftFeeling, setDraftFeeling] = useState<FeelingLevel>("okay");
  const [draftNote, setDraftNote] = useState<string>("");
  const [isSavingFeeling, setIsSavingFeeling] = useState(false);
  const [feelingEditError, setFeelingEditError] = useState<string | null>(null);
  const feelingEditDialogRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const feelingHeatmapScrollRef = useRef<HTMLDivElement>(null);
  const [hoveredDay, setHoveredDay] = useState<HeatmapFeelingDay | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);
  const [, setIsLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    async function fetchData() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const [res, feelingsRes] = await Promise.all([
          fetch(`${apiBase}/api/dashboard/summary?days=${days}`),
          fetch(`${apiBase}/api/feelings?days=365`),
        ]);
        if (res.ok) {
          const data = await res.json();
          setHealth(data.health);
          setSleep(data.sleep);
        } else {
          // Use demo data
          const today = new Date();
          setHealth(
            Array.from({ length: days }, (_, i) => {
              const d = new Date(today.getTime() - i * 86400000);
              return {
                date: d.toISOString().split("T")[0],
                resting_hr_bpm: 50 + Math.floor(Math.random() * 8),
                overnight_hrv_avg_ms: 42 + Math.floor(Math.random() * 25),
                hrv_7d_sma: 52 + Math.floor(Math.random() * 6),
                recovery_vendor: 55 + Math.floor(Math.random() * 35),
                readiness_score_app: 55 + Math.floor(Math.random() * 35),
                steps: 5000 + Math.floor(Math.random() * 8000),
              };
            })
          );
          setSleep(
            Array.from({ length: days }, (_, i) => {
              const d = new Date(today.getTime() - i * 86400000);
              const total = 21600 + Math.floor(Math.random() * 7200);
              return {
                sleep_start: d.toISOString(),
                duration_s: total,
                is_nap: false,
                stage_deep_s: Math.floor(total * (0.12 + Math.random() * 0.12)),
                stage_rem_s: Math.floor(total * (0.15 + Math.random() * 0.12)),
                stage_light_s: Math.floor(total * (0.4 + Math.random() * 0.15)),
                stage_awake_s: Math.floor(total * (0.05 + Math.random() * 0.08)),
              };
            })
          );
        }
        if (feelingsRes.ok) setFeelings(await feelingsRes.json());
      } catch {
        // fallback
      }
      setIsLoading(false);
    }
    fetchData();
  }, [days]);

  useEffect(() => {
    const dialog = feelingEditDialogRef.current;
    if (!dialog) return;
    if (editingFeelingDate && !dialog.open) dialog.showModal();
    if (!editingFeelingDate && dialog.open) dialog.close();
  }, [editingFeelingDate]);

  const months = useMemo(() => {
    const list: string[] = [];
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      list.push(d.toLocaleDateString("en-US", { month: "short" }));
    }
    return list;
  }, []);

  const heatmapDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayOfWeekToday = today.getDay(); // 0=Sun, 6=Sat
    const totalDaysToDisplay = 51 * 7 + (dayOfWeekToday + 1);

    const startDate = new Date(today);
    startDate.setDate(today.getDate() - (totalDaysToDisplay - 1));

    const feelingsMap = new Map(feelings.map((f) => [f.date, f]));
    const daysList: HeatmapFeelingDay[] = [];

    for (let wIdx = 0; wIdx < 52; wIdx++) {
      for (let dIdx = 0; dIdx < 7; dIdx++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + (wIdx * 7 + dIdx));
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const dayNum = String(d.getDate()).padStart(2, "0");
        const dateStr = `${year}-${month}-${dayNum}`;

        const isFuture = d.getTime() > today.getTime();
        const entry = feelingsMap.get(dateStr);

        daysList.push({
          dateStr,
          dayOfWeek: dIdx,
          weekIndex: wIdx,
          isFuture,
          entry,
        });
      }
    }

    return daysList;
  }, [feelings]);

  useEffect(() => {
    const scrollElement = feelingHeatmapScrollRef.current;
    if (scrollElement) scrollElement.scrollLeft = scrollElement.scrollWidth;
  }, [heatmapDays.length]);

  const handleCellHover = (item: HeatmapFeelingDay, e: React.MouseEvent<HTMLSpanElement>) => {
    if (item.isFuture) return;
    setHoveredDay(item);
    if (containerRef.current) {
      const squareRect = e.currentTarget.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;

      const cellCenterX = squareRect.left - containerRect.left + squareRect.width / 2;
      const cellTopY = squareRect.top - containerRect.top;
      const cellBottomY = squareRect.bottom - containerRect.top;

      const isLeftEdge = cellCenterX < 130;
      const isRightEdge = cellCenterX > containerWidth - 130;
      const isTopEdge = cellTopY < 80;

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

  const hrvData = [...health].reverse().map((h) => ({
    date: h.date.slice(5),
    hrv: h.overnight_hrv_avg_ms || 0,
    sma: h.hrv_7d_sma || 0,
  }));

  const rhrDays = [...health].reverse().filter((h) => h.resting_hr_bpm != null);
  const rhrData = rhrDays.map((h, index) => {
    const window = rhrDays.slice(Math.max(0, index - 6), index + 1);
    return {
      date: h.date.slice(5),
      rhr: h.resting_hr_bpm as number,
      sma: window.reduce((sum, day) => sum + (day.resting_hr_bpm as number), 0) / window.length,
    };
  });

  const sleepData = Object.values(sleep.reduce<Record<string, {
    date: string;
    deep: number;
    rem: number;
    light: number;
    awake: number;
    nap: number;
  }>>((daysByDate, session) => {
    const date = session.sleep_start.slice(5, 10);
    const day = daysByDate[date] || { date, deep: 0, rem: 0, light: 0, awake: 0, nap: 0 };
    if (session.is_nap) day.nap += session.duration_s / 3600;
    else {
      day.deep += (session.stage_deep_s || 0) / 3600;
      day.rem += (session.stage_rem_s || 0) / 3600;
      day.light += (session.stage_light_s || 0) / 3600;
      day.awake += (session.stage_awake_s || 0) / 3600;
    }
    return { ...daysByDate, [date]: day };
  }, {})).map((day) => ({ ...day, total: day.deep + day.rem + day.light + day.awake + day.nap }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const mainSleep = sleep.filter((session) => !session.is_nap);

  const readinessData = [...health].reverse().map((h) => ({
    date: h.date.slice(5),
    readiness: h.readiness_score_app || 0,
  }));

  const hrvStats = useMemo(() => {
    return computeSeriesStats(hrvData.map((d) => (d.hrv > 0 ? d.hrv : null)));
  }, [hrvData]);

  const sleepStats = useMemo(() => {
    return computeSeriesStats(
      sleepData.map((d) => {
        const sleepHours = d.deep + d.rem + d.light + d.nap;
        return sleepHours > 0 ? sleepHours : null;
      }),
      2,
    );
  }, [sleepData]);

  const readinessStats = useMemo(() => {
    return computeSeriesStats(readinessData.map((d) => (d.readiness > 0 ? d.readiness : null)));
  }, [readinessData]);

  const rhrStats = useMemo(() => {
    return computeSeriesStats(rhrData.map((d) => (d.rhr > 0 ? d.rhr : null)));
  }, [rhrData]);

  const average = (values: number[]): number | null => (
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  );
  const comparison = (value: number | null | undefined, baseline: number | null, unit: string, decimals = 0): string | undefined => {
    if (value === null || value === undefined || baseline === null) return undefined;
    const delta = value - baseline;
    return `${delta >= 0 ? "+" : ""}${delta.toFixed(decimals)} ${unit} vs prior 7-day avg`;
  };
  const latestHealth = health[0];
  const latestMainSleep = sleep.find((s) => !s.is_nap);
  const priorHealth = health.slice(1, 8);
  const priorMainSleep = sleep.filter((s) => !s.is_nap).slice(1, 8);
  const latestHrv = latestHealth?.overnight_hrv_avg_ms && latestHealth.overnight_hrv_avg_ms > 0
    ? latestHealth.overnight_hrv_avg_ms
    : null;
  const latestRhr = latestHealth?.resting_hr_bpm && latestHealth.resting_hr_bpm > 0
    ? latestHealth.resting_hr_bpm
    : null;
  const latestSleepHours = latestMainSleep && latestMainSleep.duration_s > 0
    ? latestMainSleep.duration_s / 3600
    : null;
  const restorativeRatio = (sleep: SleepSummary | undefined): number => (
    sleep && sleep.duration_s > 0
      ? ((sleep.stage_deep_s || 0) + (sleep.stage_rem_s || 0)) / sleep.duration_s * 100
      : 0
  );
  const latestRestorativeRatio = latestMainSleep && latestMainSleep.duration_s > 0
    ? restorativeRatio(latestMainSleep)
    : null;
  const hrvBaseline = average(priorHealth.flatMap((health) => (
    health.overnight_hrv_avg_ms == null ? [] : [health.overnight_hrv_avg_ms]
  )));
  const rhrBaseline = average(priorHealth.flatMap((health) => (
    health.resting_hr_bpm == null ? [] : [health.resting_hr_bpm]
  )));
  const sleepBaseline = average(priorMainSleep.map((sleep) => sleep.duration_s / 3600));
  const restorativeBaseline = average(priorMainSleep.map(restorativeRatio));
  const sleepDelta = latestSleepHours === null || sleepBaseline === null ? null : latestSleepHours - sleepBaseline;

  function beginFeelingEdit(date: string, entry: DailyFeeling | undefined) {
    setEditingFeelingDate(date);
    setDraftFeeling(entry?.feeling ?? "okay");
    setDraftNote(entry?.note ?? "");
    setFeelingEditError(null);
  }

  async function saveFeelingEdit() {
    if (!editingFeelingDate) return;
    setIsSavingFeeling(true);
    setFeelingEditError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiBase}/api/feelings/${editingFeelingDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeling: draftFeeling, note: draftNote.trim() || null }),
      });
      if (!response.ok) throw new Error("Could not save feeling");
      const saved: DailyFeeling = await response.json();
      setFeelings((current) => [saved, ...current.filter((feeling) => feeling.date !== saved.date)]);
      setEditingFeelingDate(null);
    } catch {
      setFeelingEditError("Could not save this feeling. Please try again.");
    } finally {
      setIsSavingFeeling(false);
    }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <PageTitle>Sleep & Autonomic Recovery</PageTitle>
          <SingleSelect
            ariaLabel="Sleep history period"
            id="period-selector"
            value={String(days)}
            options={[7, 14, 30, 60, 90].map((period) => ({ value: String(period), label: `${period} days` }))}
            onChange={(value) => setDays(Number(value))}
          />
        </header>

        <div className="page-body">
          {/* Summary Cards */}
          <div className="metrics-grid sleep-summary-metrics">
            <MetricCard
              label="Overnight HRV"
              value={latestHrv ?? "--"}
              unit={latestHrv !== null ? "ms" : undefined}
              accentColor="var(--color-accent-primary)"
              baselineDelta={comparison(latestHrv, hrvBaseline, "ms")}
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              )}
            />
            <MetricCard
              label="Resting HR"
              value={latestRhr ?? "--"}
              unit={latestRhr !== null ? "bpm" : undefined}
              baselineDelta={comparison(latestRhr, rhrBaseline, "bpm")}
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              )}
            />
            <MetricCard
              label="Sleep Duration"
              value={latestSleepHours !== null ? formatHoursMinutes(latestSleepHours) : "--"}
              accentColor="var(--color-accent-sleep)"
              baselineDelta={sleepDelta === null
                ? undefined
                : `${sleepDelta >= 0 ? "+" : "-"}${formatHoursMinutes(Math.abs(sleepDelta))} vs prior 7-day avg`}
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            />
            <MetricCard
              label="Restorative Sleep Ratio"
              value={latestRestorativeRatio !== null ? `${Math.round(latestRestorativeRatio)}%` : "--"}
              baselineDelta={comparison(latestRestorativeRatio, restorativeBaseline, "%")}
            />
          </div>

          {/* 1-Year Annual Feeling Heatmap */}
          <section
            className="hover-card"
            aria-labelledby="sleep-feeling-title"
            ref={containerRef}
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

                    {hoveredDay.entry ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                          <span style={{ fontSize: "18px", fontWeight: 800, color: FEELING_COLORS[hoveredDay.entry.feeling], lineHeight: 1 }}>
                            {FEELING_NAMES[hoveredDay.entry.feeling] || hoveredDay.entry.feeling}
                          </span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Check-in
                          </span>
                        </div>

                        {hoveredDay.entry.note && (
                          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", maxWidth: "210px", whiteSpace: "normal", borderTop: "1px solid var(--border-color)", paddingTop: "4px" }}>
                            {hoveredDay.entry.note}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", color: "var(--color-text-muted)", fontWeight: 500 }}>
                        No check-in (Click to log)
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
                  ATHLETE FEELING
                </span>
                <h3 style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-text-primary)", marginTop: "2px" }}>
                  Feeling log
                </h3>
              </div>
            </div>

            <div className="feeling-heatmap-scroll" ref={feelingHeatmapScrollRef}>
              {/* Month Labels Row */}
              <div className="feeling-heatmap-months" style={{ display: "flex", margin: "0 22px 6px 28px", justifyContent: "space-between", fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)" }}>
                {months.map((m, idx) => (
                  <span key={idx}>{m}</span>
                ))}
              </div>

              {/* Heatmap 7x52 Grid Container */}
              <div className="feeling-heatmap-grid" style={{ display: "flex", gap: "6px", padding: "8px 0" }}>
              {/* Weekday Labels Column */}
              <div className="heatmap-weekday-labels" style={{ display: "flex", flexDirection: "column", gap: "3px", justifyContent: "space-around", fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", width: "16px", flexShrink: 0 }}>
                {WEEKDAYS.map((w, idx) => (
                  <span key={idx} style={{ height: "11px", lineHeight: "11px" }}>{w}</span>
                ))}
              </div>

              {/* 52 Week Columns */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(52, 1fr)", gap: "3px", flex: 1 }}>
                {Array.from({ length: 52 }, (_, wIdx) => (
                  <div key={wIdx} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {Array.from({ length: 7 }, (_, dIdx) => {
                      const item = heatmapDays.find((d) => d.weekIndex === wIdx && d.dayOfWeek === dIdx);
                      if (!item) return <span key={dIdx} style={{ width: "11px", height: "11px", borderRadius: "2px", background: "transparent" }} />;

                      return (
                        <span
                          key={dIdx}
                          onClick={() => !item.isFuture && beginFeelingEdit(item.dateStr, item.entry)}
                          onMouseEnter={(e) => handleCellHover(item, e)}
                          onMouseLeave={handleCellLeave}
                          style={{
                            width: "11px",
                            height: "11px",
                            borderRadius: "3px",
                            background: item.isFuture ? "transparent" : !item.entry ? "var(--color-overlay-subtle)" : FEELING_COLORS[item.entry.feeling],
                            cursor: item.isFuture ? "default" : "pointer",
                            transition: "transform 150ms ease, box-shadow 150ms ease",
                            transform: hoveredDay?.dateStr === item.dateStr ? "scale(1.35)" : "scale(1)",
                            boxShadow: hoveredDay?.dateStr === item.dateStr && item.entry ? `0 0 8px ${FEELING_COLORS[item.entry.feeling]}` : hoveredDay?.dateStr === item.dateStr ? "0 0 6px rgba(100, 100, 100, 0.4)" : "none",
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

            {/* Legend & Summary Statistics Row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-4)", flexWrap: "wrap", gap: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "var(--space-4)" }}>
              {/* Feeling Categories Legend */}
              <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "11px", color: "var(--color-text-secondary)", flexWrap: "wrap" }}>
                {(Object.keys(FEELING_COLORS) as FeelingLevel[]).map((level) => (
                  <span key={level} style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: FEELING_COLORS[level] }} />
                    {FEELING_NAMES[level]}
                  </span>
                ))}
              </div>

              {/* Stats Summary Pills */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 12px", fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {feelings.length} logged days
                </span>
                <span style={{ background: "var(--color-surface-secondary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-full)", padding: "4px 12px", fontSize: "12px", fontWeight: 700, color: "var(--color-accent-primary)" }}>
                  {Math.round((feelings.length / 365) * 100)}% year coverage
                </span>
              </div>
            </div>
          </section>

          <dialog
            aria-labelledby="sleep-feeling-edit-title"
            className="daily-feeling-dialog sleep-feeling-edit-dialog"
            onCancel={() => setEditingFeelingDate(null)}
            onClose={() => setEditingFeelingDate(null)}
            ref={feelingEditDialogRef}
          >
            <div className="daily-feeling-dialog-content">
              <span className="daily-feeling-kicker">Edit check-in</span>
              <h2 id="sleep-feeling-edit-title">{editingFeelingDate ? formatFeelingDateTitle(editingFeelingDate) : ""}</h2>
              <p>Choose the feeling that best matches this day.</p>
              <div className="daily-feeling-options" role="radiogroup" aria-label="Choose feeling">
                {FEELING_OPTIONS.map((option) => (
                  <button
                    aria-checked={draftFeeling === option.value}
                    aria-label={option.label}
                    className={`daily-feeling-choice daily-feeling-choice--${option.value}`}
                    key={option.value}
                    onClick={() => setDraftFeeling(option.value)}
                    role="radio"
                    title={option.label}
                    type="button"
                  >
                    <img alt={option.label} aria-hidden="true" className="daily-feeling-choice-icon" src={option.icon} />
                  </button>
                ))}
              </div>
              <label className="daily-feeling-note">
                <span>Anything affecting this day? <em>Optional</em></span>
                <textarea
                  maxLength={280}
                  onChange={(event) => setDraftNote(event.target.value)}
                  placeholder="Travel, soreness, stress, illness…"
                  value={draftNote}
                />
              </label>
              {feelingEditError && <p className="daily-feeling-error" role="alert">{feelingEditError}</p>}
              <div className="sleep-feeling-editor-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingFeelingDate(null)} type="button">Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={isSavingFeeling} onClick={() => void saveFeelingEdit()} type="button">{isSavingFeeling ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </dialog>

          {/* HRV Trend */}
          <div className="card" style={{ marginBottom: "var(--space-6)" }} id="chart-hrv-trend">
            <div className="card-header">
              <span className="card-title">Heart Rate Variability</span>
              {hrvStats.sevenDayAvg !== null && (
                <ChartInsightPill
                  sevenDayAvg={hrvStats.sevenDayAvg}
                  windowAvg={hrvStats.windowAvg}
                  unit="ms"
                  sevenDayTooltip={`7-day average: ${hrvStats.sevenDayAvg} ms`}
                  windowTooltip={`Visible window average: ${hrvStats.windowAvg ?? "--"} ms`}
                />
              )}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={hrvData}>
                <defs>
                  <linearGradient id="sleepHrvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-accent-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-accent-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value) => formatChartAxisDate(value)} axisLine={false} interval="equidistantPreserveStart" />
                <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="ms" />
                <Tooltip cursor={{ fill: "var(--color-chart-cursor)" }} content={<ChartLegendTooltip unit="ms" />} />
                <Area type="monotone" dataKey="hrv" name="Overnight HRV" stroke="var(--color-accent-primary)" fill="url(#sleepHrvGrad)" strokeWidth={2} dot={{ r: 3, fill: "var(--color-accent-primary)" }} />
                <Area type="monotone" dataKey="sma" name="7-day average" stroke="var(--color-text-secondary)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", marginBottom: "var(--space-6)" }}>
            {/* Sleep Stages */}
            <div className="card" id="chart-sleep-stages">
              <div className="card-header">
                <span className="card-title">Sleep Stage Breakdown</span>
                {sleepStats.sevenDayAvg !== null && (
                  <ChartInsightPill
                    sevenDayAvg={formatSleepHours(sleepStats.sevenDayAvg)}
                    windowAvg={sleepStats.windowAvg !== null ? formatSleepHours(sleepStats.windowAvg) : null}
                    sevenDayTooltip={`7-day sleep average: ${formatSleepHours(sleepStats.sevenDayAvg)}`}
                    windowTooltip={`Visible window sleep average: ${sleepStats.windowAvg !== null ? formatSleepHours(sleepStats.windowAvg) : "--"}`}
                  />
                )}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sleepData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value) => formatChartAxisDate(value)} axisLine={false} interval="equidistantPreserveStart" />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="h" />
                  <Tooltip cursor={{ fill: "var(--color-chart-cursor)" }} content={<SleepStageTooltip />} />
                  <Bar dataKey="deep" name="Deep" stackId="s" fill="#21E6A5" />
                  <Bar dataKey="rem" name="REM" stackId="s" fill="#2D9BF0" />
                  <Bar dataKey="light" name="Light" stackId="s" fill="#8DABC2" />
                  <Bar dataKey="awake" name="Awake" stackId="s" fill="#CBD5E1">
                    {sleepData.map((day) => (
                      <Cell key={day.date} radius={day.nap > 0 ? 0 : ([4, 4, 0, 0] as unknown as number)} />
                    ))}
                  </Bar>
                  <Bar dataKey="nap" name="Nap" stackId="s" fill="#8B7CC0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Daily Readiness */}
            <div className="card" id="chart-recovery">
              <div className="card-header">
                <span className="card-title">Daily Readiness</span>
                {readinessStats.sevenDayAvg !== null && (
                  <ChartInsightPill
                    sevenDayAvg={readinessStats.sevenDayAvg}
                    windowAvg={readinessStats.windowAvg}
                    unit="%"
                    sevenDayTooltip={`7-day readiness average: ${readinessStats.sevenDayAvg}%`}
                    windowTooltip={`Visible window readiness average: ${readinessStats.windowAvg ?? "--"}%`}
                  />
                )}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={readinessData}>
                  <defs>
                    <linearGradient id="recGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-accent-exertion)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-accent-exertion)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value) => formatChartAxisDate(value)} axisLine={false} interval="equidistantPreserveStart" />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip cursor={{ fill: "var(--color-chart-cursor)" }} content={<ChartLegendTooltip unit="%" />} />
                  <Area type="monotone" dataKey="readiness" name="Readiness" stroke="var(--color-accent-exertion)" fill="url(#recGrad)" strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Resting HR Chart */}
          <div className="card" id="chart-rhr">
            <div className="card-header">
              <span className="card-title">Resting Heart Rate History</span>
              {rhrStats.sevenDayAvg !== null && (
                <ChartInsightPill
                  sevenDayAvg={rhrStats.sevenDayAvg}
                  windowAvg={rhrStats.windowAvg}
                  unit="bpm"
                  sevenDayTooltip={`7-day RHR average: ${rhrStats.sevenDayAvg} bpm`}
                  windowTooltip={`Visible window RHR average: ${rhrStats.windowAvg ?? "--"} bpm`}
                />
              )}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={rhrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value) => formatChartAxisDate(value)} axisLine={false} interval="equidistantPreserveStart" />
                <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} domain={["dataMin - 3", "dataMax + 3"]} unit="bpm" />
                <Tooltip cursor={{ fill: "var(--color-chart-cursor)" }} content={<ChartLegendTooltip unit="bpm" />} />
                <Area type="monotone" dataKey="rhr" name="Resting HR" stroke="var(--color-status-critical)" fill="rgba(255, 77, 98, 0.08)" strokeWidth={2} dot={{ r: 3 }} />
                <Area type="monotone" dataKey="sma" name="7-day average" stroke="var(--color-text-secondary)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
}
