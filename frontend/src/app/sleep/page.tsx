"use client";

import { useState, useEffect } from "react";
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
import type { HealthDay, SleepSummary } from "@/lib/types";

interface SleepTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { total: number };
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
    <div style={{ padding: "12px 14px", borderRadius: "16px", background: "#192126", border: "1px solid var(--border-color)", color: "var(--color-text-primary)" }}>
      <strong style={{ display: "block", marginBottom: "8px", color: "var(--color-text-secondary)", fontSize: "12px" }}>{label}</strong>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: "flex", justifyContent: "space-between", gap: "18px", marginTop: "5px" }}>
          <span>{entry.name}</span>
          <strong>{formatHoursMinutes(Number(entry.value))}</strong>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", marginTop: "10px", paddingTop: "9px", borderTop: "1px solid var(--border-color)" }}>
        <strong>Total</strong>
        <strong>{formatHoursMinutes(total)}</strong>
      </div>
    </div>
  );
}

export default function SleepPage() {
  const [health, setHealth] = useState<HealthDay[]>([]);
  const [sleep, setSleep] = useState<SleepSummary[]>([]);
  const [, setIsLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    async function fetchData() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiBase}/api/dashboard/summary?days=${days}`);
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
      } catch {
        // fallback
      }
      setIsLoading(false);
    }
    fetchData();
  }, [days]);

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
    nap: number;
  }>>((daysByDate, session) => {
    const date = session.sleep_start.slice(5, 10);
    const day = daysByDate[date] || { date, deep: 0, rem: 0, light: 0, nap: 0 };
    if (session.is_nap) day.nap += session.duration_s / 3600;
    else {
      day.deep += (session.stage_deep_s || 0) / 3600;
      day.rem += (session.stage_rem_s || 0) / 3600;
      day.light += (session.stage_light_s || 0) / 3600;
    }
    return { ...daysByDate, [date]: day };
  }, {})).map((day) => ({ ...day, total: day.deep + day.rem + day.light + day.nap }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const mainSleep = sleep.filter((session) => !session.is_nap);

  const readinessData = [...health].reverse().map((h) => ({
    date: h.date.slice(5),
    readiness: h.readiness_score_app || 0,
  }));

  const average = (values: number[]): number | null => (
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  );
  const comparison = (value: number, baseline: number | null, unit: string, decimals = 0): string => {
    if (baseline === null) return "No prior data";
    const delta = value - baseline;
    return `${delta >= 0 ? "+" : ""}${delta.toFixed(decimals)} ${unit} vs prior 7-day avg`;
  };
  const latestHealth = health[0];
  const latestMainSleep = mainSleep[0];
  const priorHealth = health.slice(1, 8);
  const priorMainSleep = mainSleep.slice(1, 8);
  const latestHrv = latestHealth?.overnight_hrv_avg_ms ?? 0;
  const latestRhr = latestHealth?.resting_hr_bpm ?? 0;
  const latestSleepHours = (latestMainSleep?.duration_s ?? 0) / 3600;
  const restorativeRatio = (sleep: SleepSummary | undefined): number => (
    sleep && sleep.duration_s > 0
      ? ((sleep.stage_deep_s || 0) + (sleep.stage_rem_s || 0)) / sleep.duration_s * 100
      : 0
  );
  const latestRestorativeRatio = restorativeRatio(latestMainSleep);
  const hrvBaseline = average(priorHealth.flatMap((health) => (
    health.overnight_hrv_avg_ms == null ? [] : [health.overnight_hrv_avg_ms]
  )));
  const rhrBaseline = average(priorHealth.flatMap((health) => (
    health.resting_hr_bpm == null ? [] : [health.resting_hr_bpm]
  )));
  const sleepBaseline = average(priorMainSleep.map((sleep) => sleep.duration_s / 3600));
  const restorativeBaseline = average(priorMainSleep.map(restorativeRatio));
  const sleepDelta = sleepBaseline === null ? null : latestSleepHours - sleepBaseline;

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
          <div className="metrics-grid">
            <MetricCard
              label="Overnight HRV"
              value={latestHrv}
              unit="ms"
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
              value={latestRhr}
              unit="bpm"
              baselineDelta={comparison(latestRhr, rhrBaseline, "bpm")}
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              )}
            />
            <MetricCard
              label="Sleep Duration"
              value={formatHoursMinutes(latestSleepHours)}
              accentColor="var(--color-accent-sleep)"
              baselineDelta={sleepDelta === null
                ? "No prior data"
                : `${sleepDelta >= 0 ? "+" : "-"}${formatHoursMinutes(Math.abs(sleepDelta))} vs prior 7-day avg`}
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            />
            <MetricCard
              label="Restorative Sleep Ratio"
              value={`${Math.round(latestRestorativeRatio)}%`}
              baselineDelta={comparison(latestRestorativeRatio, restorativeBaseline, "%")}
            />
          </div>

          {/* HRV Trend */}
          <div className="card" style={{ marginBottom: "var(--space-6)" }} id="chart-hrv-trend">
            <div className="card-header">
              <span className="card-title">Heart Rate Variability</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={hrvData}>
                <defs>
                  <linearGradient id="sleepHrvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-accent-primary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-accent-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} interval="equidistantPreserveStart" />
                <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="ms" />
                <Tooltip formatter={(value) => `${Math.round(Number(value))} ms`} />
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
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sleepData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} interval="equidistantPreserveStart" />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="h" />
                  <Tooltip cursor={{ fill: "rgba(255, 255, 255, 0.04)" }} content={<SleepStageTooltip />} />
                  <Bar dataKey="deep" name="Deep" stackId="s" fill="#21E6A5" />
                  <Bar dataKey="rem" name="REM" stackId="s" fill="#2D9BF0" />
                  <Bar dataKey="light" name="Light" stackId="s" fill="#8DABC2">
                    {sleepData.map((day) => (
                      <Cell key={day.date} radius={day.nap > 0 ? 0 : [4, 4, 0, 0]} />
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
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={readinessData}>
                  <defs>
                    <linearGradient id="recGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-accent-exertion)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-accent-exertion)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} interval="equidistantPreserveStart" />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip />
                  <Area type="monotone" dataKey="readiness" name="Readiness" stroke="var(--color-accent-exertion)" fill="url(#recGrad)" strokeWidth={2} dot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Resting HR Chart */}
          <div className="card" id="chart-rhr">
            <div className="card-header">
              <span className="card-title">Resting Heart Rate History</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={rhrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} interval="equidistantPreserveStart" />
                <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} domain={["dataMin - 3", "dataMax + 3"]} unit="bpm" />
                <Tooltip formatter={(value) => `${Math.round(Number(value))} bpm`} />
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
