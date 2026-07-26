"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Sidebar from "@/components/Sidebar";
import SyncButton from "@/components/SyncButton";
import ScoreRing from "@/components/ScoreRing";
import SleepCard from "@/components/SleepCard";
import Vo2Gauge from "@/components/Vo2Gauge";
import TrainingHeatmapPanel from "@/components/TrainingHeatmapPanel";
import { getSportVisual, SportIcon } from "@/components/SportActivityIcon";
import type { DashboardData } from "@/lib/types";

type WeeklyActivityMetric = "distance" | "duration" | "load";

const WEEKLY_ACTIVITY_METRICS: WeeklyActivityMetric[] = ["distance", "duration", "load"];

const WEEKLY_ACTIVITY_CONFIG: Record<
  WeeklyActivityMetric,
  { label: string; color: string }
> = {
  distance: { label: "Distance (km)", color: "#21E6A5" },
  duration: { label: "Duration", color: "#5B8DEF" },
  load: { label: "Training Load", color: "#F0B63C" },
};

interface PersonalRecord {
  type: number;
  label: string;
  distance_m: number;
  duration_s: number | null;
  pace_s_per_km: number | null;
  date: string | null;
}

interface PersonalRecordGroup {
  type: number;
  label: string;
  records: PersonalRecord[];
}

interface PersonalRecordsResponse {
  groups: PersonalRecordGroup[];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatWeeklyMetric(metric: WeeklyActivityMetric, value: number): string {
  if (metric === "distance") return `${value.toFixed(1)} km`;
  if (metric === "duration") return formatDuration(value * 3600);
  return `${Math.round(value)}`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatRecordDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRecordPace(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [personalRecords, setPersonalRecords] = useState<PersonalRecordsResponse | null>(null);
  const [selectedRecordGroup, setSelectedRecordGroup] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<WeeklyActivityMetric[]>(
    WEEKLY_ACTIVITY_METRICS,
  );

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      
      const [sumRes, prRes] = await Promise.all([
        fetch(`${apiBase}/api/dashboard/summary?days=7`),
        fetch(`${apiBase}/api/dashboard/personal-records`)
      ]);
      
      if (sumRes.ok) {
        setData(await sumRes.json());
      } else {
        setData(null);
        setLoadError("Could not load real COROS data.");
      }

      if (prRes.ok) {
        const records: PersonalRecordsResponse = await prRes.json();
        setPersonalRecords(records);
        setSelectedRecordGroup((current) => current ?? records.groups[0]?.type ?? null);
      }
    } catch {
      setData(null);
      setLoadError("Could not load real COROS data.");
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading || !data) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <header className="page-header">
            <h2 className="page-title">
              {new Date().toLocaleDateString("en-US", { weekday: 'long', month: 'short', day: 'numeric' })}
            </h2>
          </header>
          <div className="page-body">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "var(--color-text-muted)" }}>
              {isLoading ? "Loading health intelligence..." : loadError ?? "No COROS data available."}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const latestHealth = data.health[0] || {};
  const latestStepsHealth =
    data.latest_steps?.steps != null
      ? data.latest_steps
      : data.health.find((health) => health.steps != null);
  const latestSleep = data.sleep.find((sleep) => !sleep.is_nap);
  const latestSleepDate = latestSleep?.sleep_start?.slice(0, 10);
  const napSeconds = latestSleepDate
    ? data.sleep
        .filter((sleep) => sleep.is_nap && sleep.sleep_start.slice(0, 10) === latestSleepDate)
        .reduce((total, sleep) => total + sleep.duration_s, 0)
    : 0;
  const restingHrBaseline = data.health.filter(
    (health) => health.date !== latestHealth.date && typeof health.resting_hr_bpm === "number",
  );
  const restingHrDelta =
    typeof latestHealth.resting_hr_bpm === "number" && restingHrBaseline.length > 0
      ? latestHealth.resting_hr_bpm -
        restingHrBaseline.reduce((sum, health) => sum + (health.resting_hr_bpm || 0), 0) /
          restingHrBaseline.length
      : null;
  const recoveryScore =
    typeof latestHealth.recovery_vendor === "number" ? latestHealth.recovery_vendor : null;
  const recoveryMessage =
    recoveryScore === null
      ? "Sync COROS to see recovery guidance here."
      : recoveryScore >= 70
        ? "Recovery is strong. You're cleared for a hard session."
        : "Parasympathetic tone is steady. Maintain balanced training load.";
  const strainScore =
    typeof latestHealth.strain_score_app === "number" ? latestHealth.strain_score_app : null;
  const strainStatus =
    strainScore === null
      ? "Waiting"
      : strainScore < 10
        ? "Light"
        : strainScore < 14
          ? "Moderate"
          : strainScore < 18
            ? "High"
            : "All out";
  const vo2max = data.fitness.vo2max ?? null;
  const vo2maxChange =
    vo2max !== null && typeof data.fitness.vo2max_30d_avg === "number"
      ? vo2max - data.fitness.vo2max_30d_avg
      : null;
  const vo2maxTrend =
    vo2maxChange === null
      ? undefined
      : Math.abs(vo2maxChange) < 0.05
        ? "At 30d avg"
        : `${vo2maxChange >= 0 ? "+" : ""}${vo2maxChange.toFixed(1)} vs 30d avg`;
  const recordGroups = personalRecords?.groups ?? [];
  const activeRecordGroup =
    recordGroups.find((group) => group.type === selectedRecordGroup) ?? recordGroups[0];
  const displayedRecords = activeRecordGroup
    ? [
        ...activeRecordGroup.records,
        ...(activeRecordGroup.records.some((record) => record.type === 13)
          ? []
          : [
              {
                type: 13,
                label: "Marathon",
                distance_m: 42_195,
                duration_s: null,
                pace_s_per_km: null,
                date: null,
              },
            ]),
      ]
    : [];

  // Build rolling 7-day chronological bar chart data ending TODAY
  const today = new Date();
  const rawWeeklyActivityData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const dayNum = String(d.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${dayNum}`;
    const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" });

    const dayActivities = data.activities.filter((a) => a.start_time && a.start_time.startsWith(dateStr));
    const distanceKm = dayActivities.reduce((sum, a) => sum + (a.distance_m || 0), 0) / 1000;
    const durationHours = dayActivities.reduce((sum, a) => sum + (a.elapsed_time_s || 0), 0) / 3600;
    const load = dayActivities.reduce((sum, a) => sum + (a.training_load_vendor || 0), 0);

    return {
      day: dayLabel,
      dateStr,
      distance: distanceKm,
      duration: durationHours,
      load,
      isToday: i === 6,
    };
  });

  const weeklyMetricTotals = WEEKLY_ACTIVITY_METRICS.reduce(
    (totals, metric) => ({
      ...totals,
      [metric]: rawWeeklyActivityData.reduce((sum, day) => sum + day[metric], 0),
    }),
    { distance: 0, duration: 0, load: 0 },
  );
  const weeklyMetricMaxima = WEEKLY_ACTIVITY_METRICS.reduce(
    (maxima, metric) => ({
      ...maxima,
      [metric]: Math.max(...rawWeeklyActivityData.map((day) => day[metric]), 1),
    }),
    { distance: 1, duration: 1, load: 1 },
  );
  const weeklyActivityData = rawWeeklyActivityData.map((day) => ({
    ...day,
    distanceRelative: (day.distance / weeklyMetricMaxima.distance) * 100,
    durationRelative: (day.duration / weeklyMetricMaxima.duration) * 100,
    loadRelative: (day.load / weeklyMetricMaxima.load) * 100,
  }));

  // Calculate today's specific load
  const todayDateStr = today.toISOString().split("T")[0];
  const todayActivities = data.activities.filter((a) => a.start_time && a.start_time.startsWith(todayDateStr));
  const todayLoad = todayActivities.reduce((sum, a) => sum + (a.training_load_vendor || 0), 0);
  const isRelativeChart = selectedMetrics.length > 1;
  const selectedMetric = selectedMetrics[0];
  const dailyAverage = weeklyMetricTotals[selectedMetric] / 7;
  const activeDays = rawWeeklyActivityData.filter((day) =>
    selectedMetrics.some((metric) => day[metric] > 0),
  ).length;
  const bestDay = rawWeeklyActivityData.reduce((best, day) => {
    const score = selectedMetrics.reduce((sum, metric) => sum + (day[metric] / weeklyMetricMaxima[metric]), 0);
    const bestScore = selectedMetrics.reduce((sum, metric) => sum + (best[metric] / weeklyMetricMaxima[metric]), 0);
    return score > bestScore ? day : best;
  }, rawWeeklyActivityData[0]);

  function toggleWeeklyMetric(metric: WeeklyActivityMetric): void {
    setSelectedMetrics((current) => {
      if (current.includes(metric)) {
        return current.length === 1 ? current : current.filter((item) => item !== metric);
      }
      return WEEKLY_ACTIVITY_METRICS.filter((item) => current.includes(item) || item === metric);
    });
  }

  const metricSelectorLabel =
    selectedMetrics.length === WEEKLY_ACTIVITY_METRICS.length
      ? "All metrics"
      : selectedMetrics.length === 1
        ? WEEKLY_ACTIVITY_CONFIG[selectedMetric].label
        : `${WEEKLY_ACTIVITY_CONFIG[selectedMetric].label} +${selectedMetrics.length - 1}`;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <div>
            <h2 className="page-title">
              Dashboard
            </h2>
          </div>
          <SyncButton onSyncComplete={fetchData} />
        </header>

        <div className="page-body">

          {/* Main Integrated Layout Grid (Reference-Inspired) */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 360px) 1fr", gap: "var(--space-5)", marginBottom: "var(--space-6)" }}>
            {/* Left Panel: Recovery and Strain Rings + 2x2 Bento Grid */}
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-6)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "var(--space-5)",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  RECOVERY & STRAIN
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", margin: "var(--space-4) 0 var(--space-3)" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <ScoreRing
                      score={recoveryScore}
                      label=""
                      color="var(--color-accent-primary)"
                      size={136}
                      strokeWidth={9}
                    />
                    <span style={{ fontSize: "11px", fontWeight: 750, color: "var(--color-text-primary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Recovery
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <ScoreRing
                      score={strainScore}
                      maxScore={21}
                      label=""
                      color="var(--color-accent-exertion)"
                      size={136}
                      strokeWidth={9}
                      unit=""
                    />
                    <span style={{ fontSize: "11px", fontWeight: 750, color: "var(--color-text-primary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      Strain
                    </span>
                  </div>
                </div>

                <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", textAlign: "center", lineHeight: 1.5 }}>
                  {recoveryMessage} {strainScore === null ? "Strain will appear after the next health sync." : `Today’s strain is ${strainStatus.toLowerCase()}.`}
                </p>
              </div>

              {/* 2x2 Bento Grid (Refined Radial Edge Gradients & Circular Badges) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                {/* Load */}
                <div
                  style={{
                    background: "radial-gradient(circle at top left, rgba(240, 211, 72, 0.22) 0%, rgba(12, 17, 20, 0.95) 75%)",
                    border: "1px solid rgba(240, 211, 72, 0.25)",
                    borderRadius: "16px",
                    padding: "var(--space-4)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "125px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(240, 211, 72, 0.18)", color: "var(--color-status-moderate)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z" />
                      </svg>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-text-primary)", textTransform: "uppercase" }}>LOAD</span>
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                      {Math.round(todayLoad)}
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-muted)", background: "rgba(0, 0, 0, 0.4)", padding: "3px 10px", borderRadius: "12px", display: "inline-block" }}>
                        {`${Math.round(weeklyMetricTotals.load)} / 7 days`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Resting HR */}
                <div
                  style={{
                    background: "radial-gradient(circle at top left, rgba(255, 77, 98, 0.22) 0%, rgba(12, 17, 20, 0.95) 75%)",
                    border: "1px solid rgba(255, 77, 98, 0.25)",
                    borderRadius: "16px",
                    padding: "var(--space-4)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "125px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255, 77, 98, 0.18)", color: "var(--color-status-critical)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-text-primary)", textTransform: "uppercase" }}>RESTING HR</span>
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                      {latestHealth.resting_hr_bpm ? `${latestHealth.resting_hr_bpm}` : "--"}
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: restingHrDelta === null ? "var(--color-text-muted)" : restingHrDelta > 0 ? "var(--color-status-critical)" : "var(--color-status-positive)", background: "rgba(0, 0, 0, 0.4)", padding: "3px 10px", borderRadius: "12px", display: "inline-block" }}>
                        {restingHrDelta === null
                          ? "no baseline data"
                          : `${restingHrDelta >= 0 ? "+" : ""}${restingHrDelta.toFixed(1)} vs avg`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Steps */}
                <div
                  style={{
                    background: "radial-gradient(circle at top left, rgba(33, 230, 165, 0.22) 0%, rgba(12, 17, 20, 0.95) 75%)",
                    border: "1px solid rgba(33, 230, 165, 0.25)",
                    borderRadius: "16px",
                    padding: "var(--space-4)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "125px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(33, 230, 165, 0.18)", color: "var(--color-accent-primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 4.5c0 1.4-.9 2.5-2 2.5s-2-1.1-2-2.5S4.9 2 6 2s2 1.1 2 2.5ZM20 10.5c0 1.4-.9 2.5-2 2.5s-2-1.1-2-2.5S16.9 8 18 8s2 1.1 2 2.5ZM7 9l3 2 2-2 2 3-3 2-2-1-2 4" />
                      </svg>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-text-primary)", textTransform: "uppercase" }}>STEPS</span>
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                      {latestStepsHealth?.steps?.toLocaleString() || "--"}
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-muted)", background: "rgba(0, 0, 0, 0.4)", padding: "3px 10px", borderRadius: "12px", display: "inline-block" }}>
                        {latestStepsHealth
                          ? new Date(`${latestStepsHealth.date}T00:00:00`).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" }
                            )
                          : "no daily data"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Calories */}
                <div
                  style={{
                    background: "radial-gradient(circle at top left, rgba(45, 155, 240, 0.22) 0%, rgba(12, 17, 20, 0.95) 75%)",
                    border: "1px solid rgba(45, 155, 240, 0.25)",
                    borderRadius: "16px",
                    padding: "var(--space-4)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    minHeight: "125px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(45, 155, 240, 0.18)", color: "var(--color-accent-exertion)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                    <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-text-primary)", textTransform: "uppercase" }}>CALORIES</span>
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "28px", fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                      {latestStepsHealth?.active_calories_kcal?.toLocaleString() || "--"}
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-muted)", background: "rgba(0, 0, 0, 0.4)", padding: "3px 10px", borderRadius: "12px", display: "inline-block" }}>
                        {latestStepsHealth ? "today's calories" : "no daily data"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Main Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
              {/* Top Split Row: Sleep Card (Left) & VO2 Gauge Card (Right) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-5)" }}>
                <SleepCard
                  dateStr={latestSleep?.sleep_start
                    ? new Date(latestSleep.sleep_start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                    : "No sleep data"}
                  score={latestSleep?.sleep_quality_vendor}
                  durationSeconds={latestSleep?.duration_s || 24060}
                  deepSeconds={latestSleep?.stage_deep_s || 3000}
                  remSeconds={latestSleep?.stage_rem_s || 6000}
                  lightSeconds={latestSleep?.stage_light_s || 12000}
                  awakeSeconds={latestSleep?.stage_awake_s || 3060}
                  awakeCount={1}
                  napSeconds={napSeconds}
                />

                <Vo2Gauge
                  score={vo2max}
                  title="VO2 MAX"
                  subtitle="Running engine"
                  runningFitness={data.fitness.running_fitness ?? null}
                  baseline={data.fitness.vo2max_30d_avg ?? null}
                  updatedDate={data.fitness.date ? new Date(`${data.fitness.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : undefined}
                  trendText={vo2maxTrend}
                />
              </div>

              {/* Bottom: Weekly Activity Bar Chart */}
              <div
                style={{
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "20px",
                  padding: "var(--space-4) var(--space-5) var(--space-4)",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-3)",
                }}
              >
                {/* Header & metric selector */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-4)", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      WEEKLY ACTIVITY
                    </span>
                    <div style={{ display: "flex", alignItems: "center", columnGap: "16px", rowGap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                      {selectedMetrics.map((metric) => (
                        <span key={metric} style={{ display: "inline-flex", alignItems: "center", gap: "7px", whiteSpace: "nowrap" }}>
                          <span
                            aria-hidden="true"
                            style={{ width: 10, height: 10, borderRadius: 5, background: WEEKLY_ACTIVITY_CONFIG[metric].color }}
                          />
                          <span style={{ color: "var(--color-text-muted)", fontSize: "12px", fontWeight: 650 }}>
                            {WEEKLY_ACTIVITY_CONFIG[metric].label}
                          </span>
                        </span>
                      ))}
                      <span style={{ color: "var(--color-text-secondary)", fontSize: "12px", fontWeight: 650 }}>
                        Best <strong style={{ color: "var(--color-text-primary)", fontWeight: 750 }}>{bestDay.day}</strong>
                      </span>
                      <span style={{ color: "var(--color-text-secondary)", fontSize: "12px", fontWeight: 650 }}>
                        Active <strong style={{ color: "var(--color-text-primary)", fontWeight: 750 }}>{activeDays}/7</strong>
                      </span>
                      {isRelativeChart && (
                        <span style={{ color: "var(--color-text-muted)", fontSize: "10px", fontWeight: 750, letterSpacing: "0.06em" }}>
                          REL
                        </span>
                      )}
                    </div>
                  </div>

                  <details style={{ position: "relative", zIndex: 5 }}>
                    <summary
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        listStyle: "none",
                        background: "var(--color-surface-secondary)",
                        color: "var(--color-text-primary)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "999px",
                        padding: "8px 12px",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      <span style={{ display: "inline-flex", gap: "4px" }} aria-hidden="true">
                        {selectedMetrics.map((metric) => (
                          <span key={metric} style={{ width: 8, height: 8, borderRadius: 4, background: WEEKLY_ACTIVITY_CONFIG[metric].color }} />
                        ))}
                      </span>
                      {metricSelectorLabel}
                      <span aria-hidden="true" style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>⌄</span>
                    </summary>
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        width: 225,
                        padding: "10px",
                        background: "#151c20",
                        border: "1px solid var(--border-color)",
                        borderRadius: "18px",
                        boxShadow: "var(--shadow-md)",
                      }}
                    >
                      <div style={{ padding: "2px 6px 8px", color: "var(--color-text-muted)", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        Metrics
                      </div>
                      {WEEKLY_ACTIVITY_METRICS.map((metric) => {
                        const isSelected = selectedMetrics.includes(metric);
                        return (
                          <button
                            key={metric}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleWeeklyMetric(metric)}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              padding: "10px",
                              color: "var(--color-text-primary)",
                              background: isSelected ? "rgba(255, 255, 255, 0.06)" : "transparent",
                              border: 0,
                              borderRadius: "12px",
                              fontSize: "12px",
                              fontWeight: 650,
                              textAlign: "left",
                              cursor: isSelected && selectedMetrics.length === 1 ? "not-allowed" : "pointer",
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                width: 16,
                                height: 16,
                                display: "grid",
                                placeItems: "center",
                                borderRadius: 8,
                                color: "#08110e",
                                background: isSelected ? WEEKLY_ACTIVITY_CONFIG[metric].color : "rgba(255, 255, 255, 0.08)",
                                fontSize: "11px",
                              }}
                            >
                              {isSelected ? "✓" : ""}
                            </span>
                            {WEEKLY_ACTIVITY_CONFIG[metric].label}
                          </button>
                        );
                      })}
                    </div>
                  </details>
                </div>

                {/* Recharts Rounded Bar Chart (Rolling 7 Days Ending Today) */}
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={weeklyActivityData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barGap={3}>
                    <CartesianGrid strokeDasharray="2 6" stroke="rgba(255, 255, 255, 0.055)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "var(--color-text-muted)", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} dy={4} height={22} />
                    <YAxis
                      domain={isRelativeChart ? [0, 100] : [0, "auto"]}
                      allowDataOverflow={isRelativeChart}
                      tick={isRelativeChart ? false : { fill: "var(--color-text-muted)", fontSize: 10 }}
                      tickFormatter={(value: number) => {
                        if (isRelativeChart) return `${Math.round(value)}%`;
                        if (selectedMetric === "distance") return value.toFixed(value >= 10 ? 0 : 1);
                        if (selectedMetric === "duration") return `${value.toFixed(1)}h`;
                        return `${Math.round(value)}`;
                      }}
                      axisLine={false}
                      tickLine={false}
                      width={isRelativeChart ? 8 : 40}
                    />
                    {!isRelativeChart && (
                      <ReferenceLine
                        y={dailyAverage}
                        stroke="rgba(141, 171, 194, 0.48)"
                        strokeDasharray="4 5"
                        label={{ value: "AVG", position: "insideTopRight", fill: "var(--color-text-muted)", fontSize: 9 }}
                      />
                    )}
                    <Tooltip
                      cursor={{ fill: "rgba(255, 255, 255, 0.035)", radius: 10 }}
                      contentStyle={{ background: "#192126", border: "1px solid var(--border-color)", borderRadius: 16, boxShadow: "var(--shadow-sm)", fontSize: 12 }}
                      labelStyle={{ color: "var(--color-text-muted)", marginBottom: 4 }}
                      formatter={(value, name) => {
                        const metric = WEEKLY_ACTIVITY_METRICS.find(
                          (item) => WEEKLY_ACTIVITY_CONFIG[item].label === String(name),
                        );
                        if (!metric) return [value, name];
                        const chartValue = Number(value ?? 0);
                        const rawValue = isRelativeChart
                          ? (chartValue / 100) * weeklyMetricMaxima[metric]
                          : chartValue;
                        return [formatWeeklyMetric(metric, rawValue), name];
                      }}
                    />
                    {selectedMetrics.map((metric) => (
                      <Bar
                        key={metric}
                        dataKey={isRelativeChart ? `${metric}Relative` : metric}
                        name={WEEKLY_ACTIVITY_CONFIG[metric].label}
                        radius={[10, 10, 0, 0]}
                        maxBarSize={selectedMetrics.length === 1 ? 42 : 26}
                        isAnimationActive={false}
                      >
                        {weeklyActivityData.map((entry) => (
                          <Cell
                            key={`${metric}-${entry.dateStr}`}
                            fill={WEEKLY_ACTIVITY_CONFIG[metric].color}
                            fillOpacity={entry.isToday ? 1 : 0.78}
                          />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* COROS Annual Load Heatmap Panel */}
          <TrainingHeatmapPanel activities={data.activities} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-5)" }}>
            {/* Recent Activities */}
            <div className="card" id="recent-activities">
              <div className="card-header">
                <span className="card-title">Recent Activities</span>
                <Link href="/activities" className="btn btn-ghost btn-sm">View All</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {data.activities.length === 0 ? (
                  <p style={{ color: "var(--color-text-muted)", fontSize: "13px", padding: "var(--space-4) 0" }}>
                    No recent activities.
                  </p>
                ) : data.activities.slice(0, 5).map((activity) => {
                  const startedAt = new Date(activity.start_time);
                  const sportVisual = getSportVisual(activity.sport);
                  return (
                    <Link
                      key={activity.id}
                      href={`/activities/${activity.id}?sport=${encodeURIComponent(activity.sport)}`}
                      className="activity-card-item"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "76px minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: "var(--space-4)",
                        padding: "10px 12px",
                        color: "inherit",
                        textDecoration: "none",
                        background: `radial-gradient(circle at 0 0, ${sportVisual.background}, transparent 62%), var(--color-surface-secondary)`,
                        border: `1px solid ${sportVisual.background}`,
                        borderRadius: "14px",
                      }}
                    >
                      <div
                        className="activity-sport-badge"
                        aria-label={sportVisual.label}
                        style={{ height: "56px", borderRadius: "14px", display: "flex", justifyContent: "center", alignItems: "center", background: sportVisual.background, color: sportVisual.color }}
                      >
                        <SportIcon sport={activity.sport} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px", fontWeight: 750 }}>
                            {activity.title || activity.sport}
                          </span>
                        </div>
                        <span style={{ display: "block", marginTop: "5px", color: "var(--color-text-muted)", fontSize: "11px" }}>
                          {activity.distance_m ? formatDistance(activity.distance_m) : sportVisual.label} · {activity.elapsed_time_s ? formatDuration(activity.elapsed_time_s) : "--"}
                        </span>
                      </div>
                      <div style={{ textAlign: "right", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "12px" }}>
                          {startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </strong>
                        <span style={{ display: "block", marginTop: "5px", fontSize: "11px" }}>
                          {startedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="card" id="coros-personal-records">
              <div className="card-header">
                <span className="card-title">Personal Records</span>
              </div>
              {recordGroups.length === 0 ? (
                <p style={{ color: "var(--color-text-muted)", fontSize: "13px", padding: "var(--space-4) 0" }}>
                  Sync COROS to load official records.
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
                    {recordGroups.map((group) => (
                      <button
                        key={group.type}
                        type="button"
                        onClick={() => setSelectedRecordGroup(group.type)}
                        style={{
                          border: `1px solid ${group.type === activeRecordGroup?.type ? "var(--color-accent-primary)" : "var(--border-color)"}`,
                          borderRadius: "999px",
                          padding: "5px 9px",
                          background: group.type === activeRecordGroup?.type ? "rgba(33, 230, 165, 0.10)" : "transparent",
                          color: group.type === activeRecordGroup?.type ? "var(--color-accent-primary)" : "var(--color-text-secondary)",
                          cursor: "pointer",
                          fontSize: "11px",
                          fontWeight: 750,
                        }}
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                    {displayedRecords.map((record) => {
                      const isElevation = record.type === 103;
                      const isLongestRun = record.type === 101;
                      const glowColor = isElevation
                        ? "rgba(240, 211, 72, 0.14)"
                        : record.duration_s == null
                          ? "transparent"
                          : "rgba(33, 230, 165, 0.12)";
                      const value = isElevation
                        ? `${Math.round(record.distance_m)} m`
                        : isLongestRun
                          ? `${(record.distance_m / 1000).toFixed(2)} km`
                          : record.duration_s != null
                            ? formatRecordDuration(record.duration_s)
                            : "--";
                      return (
                        <div key={record.type} style={{ padding: "12px", background: `radial-gradient(circle at 0 0, ${glowColor}, transparent 64%), var(--color-surface-secondary)`, border: `1px solid ${glowColor}`, borderRadius: "14px", minWidth: 0 }}>
                          <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "11px", fontWeight: 750 }}>
                            {record.label}
                          </span>
                          <strong style={{ display: "block", marginTop: "7px", fontSize: "22px", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                            {value}
                          </strong>
                          {!isElevation && record.pace_s_per_km != null && (
                            <span style={{ display: "block", marginTop: "7px", color: "var(--color-text-secondary)", fontSize: "11px" }}>
                              {formatRecordPace(record.pace_s_per_km)} /km
                            </span>
                          )}
                          {!isElevation && record.duration_s == null && (
                            <span style={{ display: "block", marginTop: "7px", color: "var(--color-text-muted)", fontSize: "11px" }}>
                              Not recorded
                            </span>
                          )}
                          {record.date && (
                            <span style={{ display: "block", marginTop: "9px", color: "var(--color-text-muted)", fontSize: "10px" }}>
                              {new Date(`${record.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
