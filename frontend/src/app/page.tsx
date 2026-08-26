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
import PageTitle from "@/components/PageTitle";
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
  { label: string }
> = {
  distance: { label: "Distance (km)" },
  duration: { label: "Duration" },
  load: { label: "Training Load" },
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
  const selectedMetrics = WEEKLY_ACTIVITY_METRICS;

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
            <PageTitle>Dashboard</PageTitle>
            {isLoading && <div className="skeleton" aria-hidden="true" style={{ width: 82, height: 32, borderRadius: 999 }} />}
          </header>
          <div className="page-body">
            {isLoading ? (
              <div
                aria-busy="true"
                aria-label="Loading dashboard"
                className="responsive-grid dashboard-primary-grid"
                style={{ gap: "var(--space-5)" }}
              >
                <div className="card no-hover" style={{ minHeight: 650, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "var(--space-5)" }}>
                  <div>
                    <div className="skeleton" style={{ width: 112, height: 11 }} />
                    <div style={{ display: "flex", justifyContent: "space-around", gap: "var(--space-3)", margin: "var(--space-5) 0" }}>
                      {[0, 1].map((item) => (
                        <div className="skeleton" key={item} style={{ width: 136, height: 136, borderRadius: "50%" }} />
                      ))}
                    </div>
                    <div className="skeleton" style={{ width: "82%", height: 13, margin: "0 auto" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {Array.from({ length: 4 }).map((_, item) => (
                      <div className="skeleton" key={item} style={{ height: 125, borderRadius: 16 }} />
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-5)" }}>
                    {[0, 1].map((item) => (
                      <div className="card no-hover" key={item} style={{ minHeight: 306 }}>
                        <div className="skeleton" style={{ width: 90, height: 11 }} />
                        <div className="skeleton" style={{ width: "42%", height: 28, marginTop: "var(--space-4)" }} />
                        <div className="skeleton" style={{ width: "100%", height: 96, marginTop: "var(--space-5)", borderRadius: 14 }} />
                        <div className="skeleton" style={{ width: "70%", height: 12, marginTop: "var(--space-5)" }} />
                      </div>
                    ))}
                  </div>

                  <div className="card no-hover" style={{ minHeight: 324, display: "flex", flexDirection: "column" }}>
                    <div className="skeleton" style={{ width: 112, height: 11 }} />
                    <div className="skeleton" style={{ width: "46%", height: 12, marginTop: "var(--space-3)" }} />
                    <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "space-around", gap: "var(--space-4)", padding: "var(--space-6) var(--space-3) 0" }}>
                      {["38%", "62%", "52%", "78%", "46%", "88%", "70%"].map((height, item) => (
                        <div className="skeleton" key={item} style={{ width: "8%", height, borderRadius: "10px 10px 2px 2px" }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: "var(--color-status-critical)", padding: "var(--space-8) 0", textAlign: "center" }}>
                {loadError ?? "No COROS data available."}
              </div>
            )}
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
  const displayedRecords: PersonalRecord[] = (() => {
    if (!activeRecordGroup) return [];
    const STANDARD_PERSONAL_RECORDS = [
      { type: 7, label: "1K", distance_m: 1_000 },
      { type: 6, label: "3K", distance_m: 3_000 },
      { type: 5, label: "5K", distance_m: 5_000 },
      { type: 4, label: "10K", distance_m: 10_000 },
      { type: 2, label: "Half Marathon", distance_m: 21_097.5 },
      { type: 13, label: "Marathon", distance_m: 42_195 },
    ];
    const achievedMap = new Map(activeRecordGroup.records.map((record) => [record.type, record]));
    const list: PersonalRecord[] = STANDARD_PERSONAL_RECORDS.map((std) => {
      const achieved = achievedMap.get(std.type);
      if (achieved) return achieved;
      return {
        type: std.type,
        label: std.label,
        distance_m: std.distance_m,
        duration_s: null,
        pace_s_per_km: null,
        date: null,
      };
    });
    for (const record of activeRecordGroup.records) {
      if (!STANDARD_PERSONAL_RECORDS.some((std) => std.type === record.type)) {
        list.push(record);
      }
    }
    return list;
  })();

  // Build current week bar chart data starting from MONDAY (Mon - Sun)
  const today = new Date();
  const currentDayOfWeek = today.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
  const distanceToMonday = (currentDayOfWeek + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - distanceToMonday);

  const rawWeeklyActivityData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
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
      isToday: d.toDateString() === today.toDateString(),
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
  const weeklyMetricColor = (metric: WeeklyActivityMetric): string => {
    if (metric === "distance") return "var(--color-accent-primary)";
    if (metric === "duration") return "var(--color-accent-exertion)";
    return "var(--color-status-moderate)";
  };
  const dailyAverage = weeklyMetricTotals[selectedMetric] / 7;
  const activeDays = rawWeeklyActivityData.filter((day) =>
    selectedMetrics.some((metric) => day[metric] > 0),
  ).length;
  const bestDay = rawWeeklyActivityData.reduce((best, day) => {
    const score = selectedMetrics.reduce((sum, metric) => sum + (day[metric] / weeklyMetricMaxima[metric]), 0);
    const bestScore = selectedMetrics.reduce((sum, metric) => sum + (best[metric] / weeklyMetricMaxima[metric]), 0);
    return score > bestScore ? day : best;
  }, rawWeeklyActivityData[0]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <PageTitle>Dashboard</PageTitle>
          <SyncButton onSyncComplete={fetchData} />
        </header>

        <div className="page-body">

          {/* Main Integrated Layout Grid (Reference-Inspired) */}
          <div className="responsive-grid dashboard-primary-grid" style={{ gap: "var(--space-5)", marginBottom: "var(--space-6)" }}>
            {/* Left Panel: Recovery and Strain Rings + Daily Telemetry */}
            <div
              className="hover-card"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-6)",
                display: "flex",
                flexDirection: "column",
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

              <section className="daily-telemetry" aria-label="Daily telemetry">
                <header className="daily-telemetry-header">
                  <span>Daily telemetry</span>
                </header>
                <div className="daily-telemetry-grid">
                  <div className="daily-telemetry-reading">
                    <div>
                      <span>Load</span>
                      <small>{`${Math.round(weeklyMetricTotals.load)} total · 7d`}</small>
                    </div>
                    <strong>{Math.round(todayLoad)}</strong>
                  </div>

                  <div className="daily-telemetry-reading">
                    <div>
                      <span>Resting HR</span>
                      <small className={restingHrDelta !== null && restingHrDelta > 0 ? "is-alert" : ""}>
                        {restingHrDelta === null
                          ? "No baseline data"
                          : `${restingHrDelta >= 0 ? "+" : ""}${restingHrDelta.toFixed(1)} vs avg`}
                      </small>
                    </div>
                    <strong>{latestHealth.resting_hr_bpm || "--"}<em>bpm</em></strong>
                  </div>

                  <div className="daily-telemetry-reading">
                    <div>
                      <span>Steps</span>
                      <small>
                        {latestStepsHealth
                          ? new Date(`${latestStepsHealth.date}T00:00:00`).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )
                          : "No daily data"}
                      </small>
                    </div>
                    <strong>{latestStepsHealth?.steps?.toLocaleString() || "--"}</strong>
                  </div>

                  <div className="daily-telemetry-reading">
                    <div>
                      <span>Active energy</span>
                      <small>{latestStepsHealth ? "Today" : "No daily data"}</small>
                    </div>
                    <strong>{latestStepsHealth?.active_calories_kcal?.toLocaleString() || "--"}<em>kcal</em></strong>
                  </div>
                </div>
              </section>

            </div>

            {/* Right Main Column */}
            <div className="dashboard-performance-column">
              {/* Top Split Row: Sleep Card (Left) & VO2 Gauge Card (Right) */}
              <div className="dashboard-performance-top">
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
              <section className="hover-card performance-instrument weekly-instrument">
                <header className="weekly-instrument-header">
                  <div>
                    <span className="instrument-eyebrow">Weekly activity</span>
                  </div>
                </header>

                <div className="weekly-instrument-overview">
                  <div className="weekly-metrics-readings-group" style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-5)", flexWrap: "wrap" }}>
                    {selectedMetrics.map((metric) => (
                      <div key={metric} className="instrument-primary-reading">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <i style={{ width: 6, height: 6, borderRadius: "50%", background: weeklyMetricColor(metric), display: "inline-block" }} />
                          {WEEKLY_ACTIVITY_CONFIG[metric].label}
                        </span>
                        <strong>{formatWeeklyMetric(metric, weeklyMetricTotals[metric])}</strong>
                      </div>
                    ))}
                  </div>
                  <div><span>Best day</span><strong>{bestDay.day}</strong></div>
                  <div><span>Active days</span><strong>{activeDays}/7</strong></div>
                </div>


                <div className="weekly-instrument-chart">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 200 }}>
                  <BarChart data={weeklyActivityData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="2 6" stroke="var(--color-chart-grid)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "var(--color-text-muted)", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} dy={4} height={22} interval="equidistantPreserveStart" />
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
                      cursor={false}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length) return null;
                        const dayData = payload[0]?.payload;
                        const formattedDate = dayData?.dateStr
                          ? new Date(`${dayData.dateStr}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : null;

                        return (
                          <div
                            style={{
                              background: "var(--color-popover)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "14px",
                              boxShadow: "var(--shadow-md)",
                              padding: "10px 14px",
                              minWidth: "165px",
                              fontSize: "12px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                color: "var(--color-text-muted)",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                marginBottom: "8px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <span>{label}</span>
                              {formattedDate && <span style={{ fontWeight: 500, color: "var(--color-text-disabled)" }}>{formattedDate}</span>}
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {payload.map((entry: any) => {
                                const metricKey = WEEKLY_ACTIVITY_METRICS.find(
                                  (m) => WEEKLY_ACTIVITY_CONFIG[m].label === entry.name,
                                );
                                if (!metricKey) return null;
                                const rawValue = isRelativeChart
                                  ? (Number(entry.value ?? 0) / 100) * weeklyMetricMaxima[metricKey]
                                  : Number(entry.value ?? 0);

                                const displayLabel = metricKey === "distance" ? "Distance" : WEEKLY_ACTIVITY_CONFIG[metricKey].label;

                                return (
                                  <div
                                    key={entry.name}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: "12px",
                                    }}
                                  >
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-secondary)" }}>
                                      <i
                                        style={{
                                          width: 7,
                                          height: 7,
                                          borderRadius: "50%",
                                          background: weeklyMetricColor(metricKey),
                                          display: "inline-block",
                                        }}
                                      />
                                      {displayLabel}
                                    </span>
                                    <strong style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", fontWeight: 600 }}>
                                      {formatWeeklyMetric(metricKey, rawValue)}
                                    </strong>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }}
                    />
                    {selectedMetrics.map((metric) => (
                      <Bar
                        key={metric}
                        dataKey={isRelativeChart ? `${metric}Relative` : metric}
                        name={WEEKLY_ACTIVITY_CONFIG[metric].label}
                        radius={[4, 4, 0, 0]}
                        barSize={selectedMetrics.length === 1 ? 34 : 18}
                        isAnimationActive={false}
                      >
                        {weeklyActivityData.map((entry) => (
                          <Cell
                            key={`${metric}-${entry.dateStr}`}
                            fill={weeklyMetricColor(metric)}
                            fillOpacity={0.78}
                          />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
                </div>
              </section>
            </div>
          </div>

          {/* COROS Annual Load Heatmap Panel */}
          <TrainingHeatmapPanel activities={data.activities} />

          <div className="responsive-grid responsive-auto-grid" style={{ gap: "var(--space-5)" }}>
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
                  const sportVisual = getSportVisual(activity.sport, activity.title, activity.subsport);
                  return (
                    <Link
                      key={activity.id}
                      href={`/activities/${activity.id}?sport=${encodeURIComponent(activity.sport)}`}
                      className="activity-card-item dashboard-activity-card"
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
                        <SportIcon sport={activity.sport} title={activity.title} subsport={activity.subsport} />
                      </div>
                      <div className="dashboard-activity-content" style={{ minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px", fontWeight: 750 }}>
                            {activity.title || activity.sport}
                          </span>
                        </div>
                        <span style={{ display: "block", marginTop: "5px", color: "var(--color-text-muted)", fontSize: "11px" }}>
                          {activity.distance_m ? formatDistance(activity.distance_m) : sportVisual.label} · {activity.elapsed_time_s ? formatDuration(activity.elapsed_time_s) : "--"}
                        </span>
                      </div>
                      <div className="dashboard-activity-date" style={{ textAlign: "right", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "12px" }}>
                          {startedAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
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
                        className="personal-record-group-button"
                        aria-pressed={group.type === activeRecordGroup?.type}
                        onClick={() => setSelectedRecordGroup(group.type)}
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
                        <div key={record.type} style={{ padding: "12px", background: `radial-gradient(circle at 0 0, ${glowColor}, transparent 64%), var(--color-surface-secondary)`, border: `1px solid ${glowColor}`, borderRadius: "14px", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "112px" }}>
                          <div>
                            <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "11px", fontWeight: 750 }}>
                              {record.label}
                            </span>
                            <strong style={{ display: "block", marginTop: "7px", fontSize: "22px", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                              {value}
                            </strong>
                          </div>
                          <div>
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
                            {record.date ? (
                              <span style={{ display: "block", marginTop: "7px", color: "var(--color-text-muted)", fontSize: "10px" }}>
                                {new Date(`${record.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </span>
                            ) : (
                              <span style={{ display: "block", marginTop: "7px", color: "transparent", fontSize: "10px", userSelect: "none" }} aria-hidden="true">
                                &nbsp;
                              </span>
                            )}
                          </div>
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
