"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Sidebar from "@/components/Sidebar";
import ReactMarkdown from "react-markdown";

interface ActivityDetail {
  id: string;
  sport: string;
  title?: string;
  start_time: string;
  elapsed_time_s?: number;
  distance_m?: number;
  elevation_gain_m?: number;
  elevation_loss_m?: number;
  avg_hr_bpm?: number;
  max_hr_bpm?: number;
  avg_speed_mps?: number;
  max_speed_mps?: number;
  avg_power_w?: number;
  max_power_w?: number;
  avg_cadence?: number;
  calories_kcal?: number;
  training_load_vendor?: number;
  efficiency_factor_app?: number;
  cardiac_drift_pct_app?: number;
  laps: Array<{
    lap_index: number;
    elapsed_s: number;
    distance_m?: number;
    avg_hr_bpm?: number;
    avg_speed_mps?: number;
    avg_power_w?: number;
  }>;
}

interface RecordPoint {
  elapsed_s?: number;
  heart_rate_bpm?: number;
  speed_mps?: number;
  altitude_m?: number;
  power_w?: number;
  cadence?: number;
}

function formatPace(speedMps: number): string {
  if (speedMps <= 0) return "--";
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export default function ActivityDetailPage() {
  const params = useParams();
  const activityId = params.id as string;
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [records, setRecords] = useState<RecordPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [postmortem, setPostmortem] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    async function fetchDetail() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const [detailRes, recordsRes] = await Promise.all([
          fetch(`${apiBase}/api/activities/${activityId}`),
          fetch(`${apiBase}/api/activities/${activityId}/records`),
        ]);

        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setActivity(detailData);
          setPostmortem(detailData.postmortem || null);
        }
        if (recordsRes.ok) {
          const data = await recordsRes.json();
          setRecords(data.records || []);
        }
      } catch {
        // Backend not available
      }
      setIsLoading(false);
    }

    if (activityId) fetchDetail();
  }, [activityId]);

  async function generatePostmortem() {
    setIsGenerating(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/ai/postmortem/${activityId}`);
      if (res.ok) {
        const data = await res.json();
        setPostmortem(data.analysis);
      } else {
        setPostmortem("Error generating postmortem.");
      }
    } catch {
      setPostmortem("Failed to generate postmortem.");
    }
    setIsGenerating(false);
  }

  if (isLoading) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <header className="page-header"><h2 className="page-title">Activity Detail</h2></header>
          <div className="page-body" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", color: "var(--color-text-muted)" }}>
            Loading...
          </div>
        </main>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <header className="page-header"><h2 className="page-title">Activity Not Found</h2></header>
          <div className="page-body" style={{ textAlign: "center", paddingTop: "var(--space-16)", color: "var(--color-text-muted)" }}>
            <p>Activity not found. It may not have been imported yet.</p>
            <Link href="/activities" className="btn btn-secondary" style={{ marginTop: "var(--space-4)" }}>Back to Activities</Link>
          </div>
        </main>
      </div>
    );
  }

  // Downsample records for chart rendering (every nth point)
  const sampleRate = Math.max(1, Math.floor(records.length / 300));
  const chartData = records
    .filter((_, i) => i % sampleRate === 0)
    .map((r) => ({
      time: r.elapsed_s ? Math.round(r.elapsed_s / 60) : 0,
      hr: r.heart_rate_bpm,
      speed: r.speed_mps ? Math.round(r.speed_mps * 3.6 * 10) / 10 : undefined,
      alt: r.altitude_m ? Math.round(r.altitude_m) : undefined,
      power: r.power_w,
    }));

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">{activity.title || activity.sport}</h2>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
            {new Date(activity.start_time).toLocaleString()}
          </span>
        </header>
        <div className="page-body">
          {/* Summary Metrics */}
          <div className="metrics-grid">
            {activity.distance_m != null && (
              <div className="metric-card">
                <div className="metric-label">Distance</div>
                <div className="metric-value">{(activity.distance_m / 1000).toFixed(2)}<span className="card-value-unit">km</span></div>
              </div>
            )}
            {activity.elapsed_time_s != null && (
              <div className="metric-card">
                <div className="metric-label">Duration</div>
                <div className="metric-value">{Math.floor(activity.elapsed_time_s / 3600)}:{String(Math.floor((activity.elapsed_time_s % 3600) / 60)).padStart(2, "0")}:{String(Math.round(activity.elapsed_time_s % 60)).padStart(2, "0")}</div>
              </div>
            )}
            {activity.avg_hr_bpm != null && (
              <div className="metric-card">
                <div className="metric-label">Avg / Max HR</div>
                <div className="metric-value">{activity.avg_hr_bpm}<span className="card-value-unit">/ {activity.max_hr_bpm} bpm</span></div>
              </div>
            )}
            {activity.avg_speed_mps != null && (
              <div className="metric-card">
                <div className="metric-label">Avg Pace</div>
                <div className="metric-value">{formatPace(activity.avg_speed_mps)}<span className="card-value-unit">/km</span></div>
              </div>
            )}
            {activity.avg_power_w != null && (
              <div className="metric-card">
                <div className="metric-label">Avg / Max Power</div>
                <div className="metric-value">{activity.avg_power_w}<span className="card-value-unit">/ {activity.max_power_w} W</span></div>
              </div>
            )}
            {activity.elevation_gain_m != null && (
              <div className="metric-card">
                <div className="metric-label">Elevation</div>
                <div className="metric-value">+{Math.round(activity.elevation_gain_m)}<span className="card-value-unit">/ -{Math.round(activity.elevation_loss_m || 0)} m</span></div>
              </div>
            )}
            {activity.training_load_vendor != null && (
              <div className="metric-card">
                <div className="metric-label">Training Load</div>
                <div className="metric-value">{activity.training_load_vendor}</div>
              </div>
            )}
            {activity.calories_kcal != null && (
              <div className="metric-card">
                <div className="metric-label">Calories</div>
                <div className="metric-value">{activity.calories_kcal}<span className="card-value-unit">kcal</span></div>
              </div>
            )}
          </div>

          {/* Time-Series Charts */}
          {chartData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-4)" }}>
              <div className="chart-container" id="chart-hr-speed">
                <div className="chart-header">
                  <div className="chart-title">Heart Rate & Speed</div>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                    <XAxis dataKey="time" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="min" />
                    <YAxis yAxisId="hr" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} domain={["dataMin - 10", "dataMax + 10"]} />
                    <YAxis yAxisId="speed" orientation="right" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="km/h" />
                    <Tooltip contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }} />
                    <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="var(--chart-4)" strokeWidth={1.5} dot={false} name="Heart Rate (bpm)" />
                    <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="var(--chart-1)" strokeWidth={1.5} dot={false} name="Speed (km/h)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {chartData.some((d) => d.alt != null) && (
                <div className="chart-container" id="chart-elevation">
                  <div className="chart-header">
                    <div className="chart-title">Elevation Profile</div>
                  </div>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="time" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} />
                      <YAxis tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="m" />
                      <Tooltip contentStyle={{ background: "var(--color-bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="alt" stroke="var(--chart-2)" strokeWidth={1.5} dot={false} name="Elevation (m)" fill="rgba(16,185,129,0.1)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Laps Table */}
          {activity.laps.length > 0 && (
            <div className="card" style={{ marginTop: "var(--space-4)" }} id="laps-table">
              <div className="card-header">
                <div className="card-title">Laps</div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lap</th>
                    <th>Distance</th>
                    <th>Duration</th>
                    <th>Avg HR</th>
                    <th>Pace</th>
                    <th>Power</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.laps.map((lap) => (
                    <tr key={lap.lap_index}>
                      <td className="mono">{lap.lap_index + 1}</td>
                      <td className="mono">{lap.distance_m ? `${(lap.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                      <td className="mono">{Math.floor(lap.elapsed_s / 60)}:{String(Math.round(lap.elapsed_s % 60)).padStart(2, "0")}</td>
                      <td className="mono">{lap.avg_hr_bpm || "--"}</td>
                      <td className="mono">{lap.avg_speed_mps ? formatPace(lap.avg_speed_mps) : "--"}</td>
                      <td className="mono">{lap.avg_power_w ? `${lap.avg_power_w}W` : "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* App-Derived Insights */}
          {(activity.efficiency_factor_app || activity.cardiac_drift_pct_app) && (
            <div className="card" style={{ marginTop: "var(--space-4)" }}>
              <div className="card-header">
                <div className="card-title">App-Derived Insights</div>
                <span className="badge badge-source">app-computed</span>
              </div>
              <div className="metrics-grid" style={{ marginBottom: 0 }}>
                {activity.efficiency_factor_app && (
                  <div className="metric-card">
                    <div className="metric-label">Efficiency Factor</div>
                    <div className="metric-value">{activity.efficiency_factor_app.toFixed(4)}</div>
                  </div>
                )}
                {activity.cardiac_drift_pct_app != null && (
                  <div className="metric-card">
                    <div className="metric-label">Cardiac Drift</div>
                    <div className="metric-value" style={{ color: Math.abs(activity.cardiac_drift_pct_app) > 5 ? "var(--color-warning)" : "var(--color-success)" }}>
                      {activity.cardiac_drift_pct_app > 0 ? "+" : ""}{activity.cardiac_drift_pct_app.toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Postmortem */}
          <div className="card" style={{ marginTop: "var(--space-4)" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="card-title">AI Coach Postmortem</div>
              <button className="btn btn-secondary" onClick={generatePostmortem} disabled={isGenerating}>
                {isGenerating ? "Generating..." : "Analyze Workout"}
              </button>
            </div>
            {postmortem && (
              <div className="markdown-body" style={{ marginTop: "1rem", padding: "16px", background: "var(--color-bg-elevated)", borderRadius: "8px", border: "1px solid var(--border-color)" }}>
                <ReactMarkdown>
                  {postmortem}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
