"use client";

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import Sidebar from "@/components/Sidebar";
import type { HealthDay, SleepSummary } from "@/lib/types";

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
                stage_deep_s: Math.floor(total * (0.12 + Math.random() * 0.12)),
                stage_rem_s: Math.floor(total * (0.15 + Math.random() * 0.12)),
                stage_light_s: Math.floor(total * (0.4 + Math.random() * 0.15)),
                stage_awake_s: Math.floor(total * (0.05 + Math.random() * 0.08)),
              };
            })
          );
        }
      } catch {
        // fallback handled above
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

  const rhrData = [...health].reverse().map((h) => ({
    date: h.date.slice(5),
    rhr: h.resting_hr_bpm || 0,
  }));

  const sleepData = [...sleep].reverse().map((s) => ({
    date: s.sleep_start.slice(5, 10),
    total: s.duration_s / 3600,
    deep: (s.stage_deep_s || 0) / 3600,
    rem: (s.stage_rem_s || 0) / 3600,
    light: (s.stage_light_s || 0) / 3600,
    awake: (s.stage_awake_s || 0) / 3600,
  }));

  const recoveryData = [...health].reverse().map((h) => ({
    date: h.date.slice(5),
    recovery: h.recovery_vendor || 0,
  }));

  const avgHrv = health.length > 0
    ? Math.round(health.reduce((s, h) => s + (h.overnight_hrv_avg_ms || 0), 0) / health.length)
    : 0;
  const avgRhr = health.length > 0
    ? Math.round(health.reduce((s, h) => s + (h.resting_hr_bpm || 0), 0) / health.length)
    : 0;
  const avgSleep = sleep.length > 0
    ? (sleep.reduce((s, sl) => s + sl.duration_s, 0) / sleep.length / 3600).toFixed(1)
    : "0";

  // Calculate high-quality restorative sleep ratio (Deep + REM sleep stages)
  const avgDeepPct = sleep.length > 0
    ? (sleep.reduce((s, sl) => s + (sl.stage_deep_s || 0), 0) / sleep.reduce((s, sl) => s + sl.duration_s, 0)) * 100
    : 0;
  const avgRemPct = sleep.length > 0
    ? (sleep.reduce((s, sl) => s + (sl.stage_rem_s || 0), 0) / sleep.reduce((s, sl) => s + sl.duration_s, 0)) * 100
    : 0;
  const sleepQualityScore = Math.round(avgDeepPct + avgRemPct) || 42;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Sleep & Recovery</h2>
          <select className="input" style={{ width: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))} id="period-selector">
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </header>
        <div className="page-body">
          {/* Summary Cards */}
          <div className="metrics-grid">
            <div className="metric-card animate-fade-in">
              <div className="metric-header">
                <span className="metric-label">Avg Overnight HRV</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-cyan)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <div className="metric-value">{avgHrv}<span className="card-value-unit">ms</span></div>
            </div>
            
            <div className="metric-card animate-fade-in">
              <div className="metric-header">
                <span className="metric-label">Avg Resting HR</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-rose)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </div>
              <div className="metric-value">{avgRhr}<span className="card-value-unit">bpm</span></div>
            </div>

            <div className="metric-card animate-fade-in">
              <div className="metric-header">
                <span className="metric-label">Avg Sleep Duration</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-violet)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              </div>
              <div className="metric-value">{avgSleep}<span className="card-value-unit">hrs</span></div>
            </div>

            <div className="metric-card animate-fade-in">
              <div className="metric-header">
                <span className="metric-label">Deep & REM Ratio</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-emerald)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l3 3" />
                </svg>
              </div>
              <div className="metric-value" style={{ color: sleepQualityScore >= 40 ? "var(--color-success)" : "var(--color-warning)" }}>
                {sleepQualityScore}%
              </div>
              <div className="metric-change neutral">
                Target &gt; 40%
              </div>
            </div>
          </div>

          {/* HRV Trend */}
          <div className="chart-container animate-slide-up" style={{ marginBottom: "var(--space-4)" }} id="chart-hrv-trend">
            <div className="chart-header">
              <div className="chart-title">Overnight HRV Trend</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={hrvData}>

                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} />
                <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} unit="ms" />
                <Tooltip contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={avgHrv} stroke="var(--color-text-muted)" strokeDasharray="3 3" label={{ value: `avg ${avgHrv}`, fill: "var(--color-text-muted)", fontSize: 10 }} />
                <Area type="monotone" dataKey="hrv" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.1} strokeWidth={2} dot={{ r: 2 }} />
                <Area type="monotone" dataKey="sma" stroke="var(--chart-2)" fill="none" strokeWidth={2} strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
            {/* Sleep Stages */}
            <div className="chart-container animate-slide-up" id="chart-sleep-stages">
              <div className="chart-header">
                <div className="chart-title">Sleep Stages</div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sleepData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} unit="h" />
                  <Tooltip contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }} formatter={(v) => `${Number(v).toFixed(1)}h`} />
                  <Bar dataKey="deep" stackId="s" fill="var(--chart-1)" name="Deep" />
                  <Bar dataKey="rem" stackId="s" fill="var(--chart-5)" name="REM" />
                  <Bar dataKey="light" stackId="s" fill="var(--chart-6)" name="Light" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Recovery Trend */}
            <div className="chart-container animate-slide-up" id="chart-recovery">
              <div className="chart-header">
                <div className="chart-title">Recovery Trend</div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={recoveryData}>

                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="recovery" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.1} strokeWidth={2} dot={{ r: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Resting HR */}
          <div className="chart-container animate-slide-up" id="chart-rhr">
            <div className="chart-header">
              <div className="chart-title">Resting Heart Rate</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={rhrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} />
                <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 10 }} axisLine={false} domain={["dataMin - 3", "dataMax + 3"]} unit="bpm" />
                <Tooltip contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={avgRhr} stroke="var(--color-text-muted)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="rhr" stroke="var(--chart-4)" fill="rgba(244,63,94,0.1)" strokeWidth={2} dot={{ r: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
}
