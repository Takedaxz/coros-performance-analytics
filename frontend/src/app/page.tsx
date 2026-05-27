"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
} from "recharts";
import Sidebar from "@/components/Sidebar";
import SyncButton from "@/components/SyncButton";
import type { DashboardData } from "@/lib/types";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatPace(speedMps: number, sport: string): string {
  if (speedMps <= 0) return "--";
  const s = sport.toLowerCase();
  if (s === "swim") {
    const paceSecsPer100m = 100 / speedMps;
    const min = Math.floor(paceSecsPer100m / 60);
    const sec = Math.round(paceSecsPer100m % 60);
    return `${min}:${sec.toString().padStart(2, "0")}/100m`;
  } else if (s === "ride" || s === "multisport") {
    const kmh = speedMps * 3.6;
    return `${kmh.toFixed(1)} km/h`;
  }
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

function renderSportBadge(sport: string): React.ReactNode {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    run: { label: "Run", bg: "rgba(255, 106, 0, 0.12)", text: "var(--color-accent-blue-light)" },
    trail_run: { label: "Trail Run", bg: "rgba(6, 182, 212, 0.12)", text: "var(--color-accent-cyan)" },
    ride: { label: "Ride", bg: "rgba(16, 185, 129, 0.12)", text: "var(--color-accent-emerald)" },
    swim: { label: "Swim", bg: "rgba(139, 92, 246, 0.12)", text: "var(--color-accent-violet)" },
    hike: { label: "Hike", bg: "rgba(99, 102, 241, 0.12)", text: "var(--color-accent-indigo)" },
    walk: { label: "Walk", bg: "rgba(244, 63, 94, 0.12)", text: "var(--color-accent-rose)" },
    strength: { label: "Strength", bg: "rgba(245, 158, 11, 0.12)", text: "var(--color-accent-amber)" },
  };

  const config = map[sport] || { label: sport.toUpperCase(), bg: "rgba(255, 255, 255, 0.06)", text: "var(--color-text-secondary)" };
  return (
    <span
      className="badge"
      style={{
        backgroundColor: config.bg,
        color: config.text,
        fontWeight: "var(--weight-semibold)",
        fontSize: "var(--text-xs)",
        padding: "2px 8px",
        borderRadius: "var(--radius-sm)",
        textTransform: "uppercase",
        letterSpacing: "0.02em"
      }}
    >
      {config.label}
    </span>
  );
}

// Demo data for visual preview when backend is not connected
function getDemoData(): DashboardData {
  const today = new Date();
  return {
    period_days: 7,
    activities: [
      { id: "1", sport: "run", title: "Morning Easy Run", start_time: new Date(today.getTime() - 86400000).toISOString(), distance_m: 8200, elapsed_time_s: 2580, avg_hr_bpm: 142, calories_kcal: 520, training_load_vendor: 78, source_type: "mcp_official", avg_speed_mps: 3.18 },
      { id: "2", sport: "ride", title: "Zone 2 Ride", start_time: new Date(today.getTime() - 2 * 86400000).toISOString(), distance_m: 42000, elapsed_time_s: 5400, avg_hr_bpm: 135, calories_kcal: 890, training_load_vendor: 95, source_type: "fit", avg_speed_mps: 7.78 },
      { id: "3", sport: "run", title: "Tempo Intervals", start_time: new Date(today.getTime() - 3 * 86400000).toISOString(), distance_m: 10500, elapsed_time_s: 3120, avg_hr_bpm: 162, calories_kcal: 680, training_load_vendor: 120, source_type: "mcp_official", avg_speed_mps: 3.37 },
      { id: "4", sport: "strength", title: "Upper Body", start_time: new Date(today.getTime() - 4 * 86400000).toISOString(), distance_m: 0, elapsed_time_s: 3600, avg_hr_bpm: 118, calories_kcal: 320, training_load_vendor: 45, source_type: "fit" },
      { id: "5", sport: "run", title: "Long Run", start_time: new Date(today.getTime() - 5 * 86400000).toISOString(), distance_m: 18000, elapsed_time_s: 6300, avg_hr_bpm: 148, calories_kcal: 1120, training_load_vendor: 145, source_type: "fit", avg_speed_mps: 2.86 },
    ],
    health: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() - i * 86400000);
      return {
        date: d.toISOString().split("T")[0],
        resting_hr_bpm: 52 + Math.floor(Math.random() * 6),
        overnight_hrv_avg_ms: 48 + Math.floor(Math.random() * 18),
        hrv_7d_sma: 54 + Math.floor(Math.random() * 4),
        recovery_vendor: 60 + Math.floor(Math.random() * 30),
        steps: 6000 + Math.floor(Math.random() * 6000),
        readiness_score_app: 65 + Math.floor(Math.random() * 25),
        strain_score_app: 12 + Math.floor(Math.random() * 6),
      };
    }),
    sleep: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() - i * 86400000);
      const total = 25200 + Math.floor(Math.random() * 3600);
      return {
        sleep_start: d.toISOString(),
        duration_s: total,
        stage_deep_s: Math.floor(total * 0.18),
        stage_rem_s: Math.floor(total * 0.22),
        stage_light_s: Math.floor(total * 0.5),
        stage_awake_s: Math.floor(total * 0.1),
      };
    }),
    fitness: {
      vo2max: 52.4,
      ftp: 265,
      running_fitness: 78,
      biological_age: 18,
      date: today.toISOString().split("T")[0],
    },
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [personalRecords, setPersonalRecords] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      
      const [sumRes, prRes] = await Promise.all([
        fetch(`${apiBase}/api/dashboard/summary?days=7`),
        fetch(`${apiBase}/api/dashboard/personal-records`)
      ]);
      
      if (sumRes.ok) {
        setData(await sumRes.json());
      } else {
        setData(getDemoData());
      }

      if (prRes.ok) {
        setPersonalRecords(await prRes.json());
      }
    } catch {
      setData(getDemoData());
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
            <h2 className="page-title">Dashboard</h2>
          </header>
          <div className="page-body">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "var(--color-text-muted)" }}>
              Loading...
            </div>
          </div>
        </main>
      </div>
    );
  }

  const latestHealth = data.health[0];
  const weeklyLoad = data.activities.reduce((sum, a) => sum + (a.training_load_vendor || 0), 0);
  const avgSleepHours = data.sleep.length > 0
    ? data.sleep.reduce((sum, s) => sum + s.duration_s, 0) / data.sleep.length / 3600
    : 0;

  const hrvChartData = [...data.health].reverse().map((h) => ({
    date: h.date.slice(5),
    hrv: h.overnight_hrv_avg_ms || 0,
    sma: h.hrv_7d_sma || 0,
  }));

  const sleepChartData = [...data.sleep].reverse().map((s) => ({
    date: s.sleep_start.slice(5, 10),
    deep: (s.stage_deep_s || 0) / 3600,
    rem: (s.stage_rem_s || 0) / 3600,
    light: (s.stage_light_s || 0) / 3600,
    awake: (s.stage_awake_s || 0) / 3600,
  }));

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Dashboard</h2>
          <SyncButton onSyncComplete={fetchData} />
        </header>
        <div className="page-body">
          <div className="metrics-grid">
            <div className="metric-card animate-fade-in" id="metric-readiness">
              <div className="metric-header">
                <span className="metric-label">Readiness</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-emerald)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div className="metric-value" style={{ color: (latestHealth?.readiness_score_app || 0) >= 70 ? "var(--color-success)" : ((latestHealth?.readiness_score_app || 0) >= 50 ? "var(--color-warning)" : "var(--color-danger)") }}>
                {latestHealth?.readiness_score_app || "--"}
              </div>
              <div className={`metric-change ${(latestHealth?.recovery_vendor || 0) >= 70 ? "positive" : "neutral"}`}>
                Vendor Rec: {latestHealth?.recovery_vendor || "--"}%
              </div>
            </div>

            <div className="metric-card animate-fade-in" id="metric-hrv">
              <div className="metric-header">
                <span className="metric-label">Overnight HRV</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-cyan)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <div className="metric-value">{latestHealth?.overnight_hrv_avg_ms || "--"}<span className="card-value-unit">ms</span></div>
              <div className="metric-change neutral">
                7d avg: {latestHealth?.hrv_7d_sma || "--"} ms
              </div>
            </div>

            <div className="metric-card animate-fade-in" id="metric-rhr">
              <div className="metric-header">
                <span className="metric-label">Resting HR</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-rose)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </div>
              <div className="metric-value">{latestHealth?.resting_hr_bpm || "--"}<span className="card-value-unit">bpm</span></div>
            </div>

            <div className="metric-card animate-fade-in" id="metric-sleep">
              <div className="metric-header">
                <span className="metric-label">Avg Sleep</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-violet)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              </div>
              <div className="metric-value">{avgSleepHours.toFixed(1)}<span className="card-value-unit">hrs</span></div>
            </div>

            <div className="metric-card animate-fade-in" id="metric-strain" style={{ position: 'relative', overflow: 'hidden' }}>
              <div className="metric-header">
                <span className="metric-label">Daily Strain</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-blue)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12h4l3-9 5 18 3-9h5" />
                </svg>
              </div>
              <div className="metric-value" style={{ color: "var(--color-accent-blue)" }}>
                {latestHealth?.strain_score_app?.toFixed(1) || "0.0"}
              </div>
              <div className="metric-change neutral">
                / 21.0 capacity
              </div>
            </div>

            <div className="metric-card animate-fade-in" id="metric-load">
              <div className="metric-header">
                <span className="metric-label">Weekly Load</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-amber)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <div className="metric-value">{Math.round(weeklyLoad)}</div>
              <div className="metric-change neutral">
                {data.activities.length} sessions
              </div>
            </div>

            <div className="metric-card animate-fade-in" id="metric-vo2max">
              <div className="metric-header">
                <span className="metric-label">VO2 Max</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-blue-light)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" />
                  <path d="M12 2a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4z" />
                </svg>
              </div>
              <div className="metric-value">{data.fitness.vo2max || "--"}</div>
              {data.fitness.ftp && (
                <div className="metric-change neutral">FTP: {data.fitness.ftp}W</div>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
            <div className="chart-container animate-slide-up" id="chart-hrv">
              <div className="chart-header">
                <div className="chart-title">Overnight HRV Trend</div>
                <div className="chart-legend">
                  <div className="chart-legend-item">
                    <div className="chart-legend-dot" style={{ background: "var(--chart-1)" }} />
                    HRV
                  </div>
                  <div className="chart-legend-item">
                    <div className="chart-legend-dot" style={{ background: "var(--chart-2)" }} />
                    7-Day SMA
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={hrvChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "var(--color-text-secondary)" }}
                  />
                  <Area type="monotone" dataKey="hrv" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.1} strokeWidth={2} dot={{ r: 3, fill: "var(--chart-1)" }} />
                  <Area type="monotone" dataKey="sma" stroke="var(--chart-2)" fill="none" strokeWidth={2} strokeDasharray="5 5" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-container animate-slide-up" id="chart-sleep">
              <div className="chart-header">
                <div className="chart-title">Sleep Stages</div>
                <div className="chart-legend">
                  <div className="chart-legend-item"><div className="chart-legend-dot" style={{ background: "var(--chart-1)" }} />Deep</div>
                  <div className="chart-legend-item"><div className="chart-legend-dot" style={{ background: "var(--chart-5)" }} />REM</div>
                  <div className="chart-legend-item"><div className="chart-legend-dot" style={{ background: "var(--chart-6)" }} />Light</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sleepChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} />
                  <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="h" />
                  <Tooltip
                    contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }}
                    formatter={(value) => `${Number(value).toFixed(1)}h`}
                  />
                  <Bar dataKey="deep" stackId="a" fill="var(--chart-1)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="rem" stackId="a" fill="var(--chart-5)" />
                  <Bar dataKey="light" stackId="a" fill="var(--chart-6)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card no-hover animate-slide-up" id="recent-activities">
            <div className="card-header">
              <div className="card-title">Recent Activities</div>
              <Link href="/activities" className="btn btn-ghost btn-sm">View All</Link>
            </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th>Date</th>
                    <th>Distance</th>
                    <th>Duration</th>
                    <th>Avg HR</th>
                    <th>Pace</th>
                    <th>Load</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.activities.map((activity) => (
                    <tr key={activity.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                          {renderSportBadge(activity.sport)}
                          <span>{activity.title || activity.sport}</span>
                        </div>
                      </td>
                      <td className="mono">{new Date(activity.start_time).toLocaleDateString("en-GB")}</td>
                      <td className="mono">{activity.distance_m ? formatDistance(activity.distance_m) : "--"}</td>
                      <td className="mono">{activity.elapsed_time_s ? formatDuration(activity.elapsed_time_s) : "--"}</td>
                      <td className="mono">{activity.avg_hr_bpm || "--"}</td>
                      <td className="mono">{activity.avg_speed_mps ? formatPace(activity.avg_speed_mps, activity.sport) : "--"}</td>
                      <td className="mono">{activity.training_load_vendor || "--"}</td>
                      <td><span className="badge badge-source">{activity.source_type}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {personalRecords && Object.keys(personalRecords).length > 0 && (
            <div className="card animate-slide-up" style={{ marginTop: "var(--space-6)" }}>
              <div className="card-header" style={{ marginBottom: "var(--space-4)" }}>
                <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-blue-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                    <path d="M4 22h16"></path>
                    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                  </svg>
                  Trophy Cabinet
                </div>
              </div>
              <div className="metrics-grid">
                {personalRecords.longest_run && (
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-label">Longest Run</span>
                    </div>
                    <div className="metric-value">{(personalRecords.longest_run.distance_m / 1000).toFixed(2)}<span className="card-value-unit">km</span></div>
                    <div className="metric-change neutral" style={{ marginTop: "var(--space-2)" }}>
                      {new Date(personalRecords.longest_run.date).toLocaleDateString("en-GB")}
                    </div>
                  </div>
                )}
                {personalRecords.best_pace_run && (() => {
                  const p = personalRecords.best_pace_run;
                  const paceMin = Math.floor(p.pace_s_per_km / 60);
                  const paceSec = String(p.pace_s_per_km % 60).padStart(2, "0");
                  return (
                    <div className="metric-card">
                      <div className="metric-header">
                        <span className="metric-label">Best Avg Pace</span>
                      </div>
                      <div className="metric-value">{paceMin}:{paceSec}<span className="card-value-unit">/km</span></div>
                      <div className="metric-change neutral" style={{ marginTop: "var(--space-2)" }}>
                        {(p.distance_m / 1000).toFixed(1)} km &middot; {new Date(p.date).toLocaleDateString("en-GB")}
                      </div>
                    </div>
                  );
                })()}
                {personalRecords.six_month_totals && (
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-label">Last 6 Months</span>
                    </div>
                    <div className="metric-value">{personalRecords.six_month_totals.total_distance_km.toLocaleString()}<span className="card-value-unit">km</span></div>
                    <div className="metric-change neutral" style={{ marginTop: "var(--space-2)" }}>
                      {personalRecords.six_month_totals.total_activities} activities
                    </div>
                  </div>
                )}
                {personalRecords.longest_ride && (
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-label">Longest Ride</span>
                    </div>
                    <div className="metric-value">{(personalRecords.longest_ride.distance_m / 1000).toFixed(1)}<span className="card-value-unit">km</span></div>
                    <div className="metric-change neutral" style={{ marginTop: "var(--space-2)" }}>
                      {new Date(personalRecords.longest_ride.date).toLocaleDateString("en-GB")}
                    </div>
                  </div>
                )}
                {personalRecords.highest_power_ride && (
                  <div className="metric-card">
                    <div className="metric-header">
                      <span className="metric-label">Highest Power</span>
                    </div>
                    <div className="metric-value">{personalRecords.highest_power_ride.max_power_w}<span className="card-value-unit">W</span></div>
                    <div className="metric-change neutral" style={{ marginTop: "var(--space-2)" }}>
                      {new Date(personalRecords.highest_power_ride.date).toLocaleDateString("en-GB")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
