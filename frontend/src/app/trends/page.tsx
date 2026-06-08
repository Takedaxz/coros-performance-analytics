"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface TrainingLoadDay {
  date: string;
  total_load: number;
}

interface HrZone {
  zone: number;
  label: string;
  hr_range: string;
  minutes: number;
  activities: string[];
}

interface WeeklyHrZones {
  week_start: string;
  week_end: string;
  max_hr_used: number;
  total_minutes: number;
  zones: HrZone[];
}

const ZONE_COLORS: Record<number, string> = {
  1: "var(--zone-1)", // #cccccc — Active Recovery
  2: "var(--zone-2)", // #aaaaaa — Aerobic Base
  3: "var(--zone-3)", // #777777 — Aerobic Threshold
  4: "var(--zone-4)", // #444444 — Lactate Threshold
  5: "var(--zone-5)", // #111111 — VO2 Max
};

export default function TrendsPage() {
  const [data, setData] = useState<TrainingLoadDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hrZones, setHrZones] = useState<WeeklyHrZones | null>(null);
  const [hrLoading, setHrLoading] = useState(true);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    async function fetchTrainingLoad() {
      try {
        const res = await fetch(`${apiBase}/api/dashboard/training-load?days=42`);
        if (res.ok) {
          const json = await res.json();
          setData(json.reverse());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    async function fetchHrZones() {
      try {
        const res = await fetch(`${apiBase}/api/dashboard/weekly-hr-zones`);
        if (res.ok) {
          const json: WeeklyHrZones = await res.json();
          setHrZones(json);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setHrLoading(false);
      }
    }

    fetchTrainingLoad();
    fetchHrZones();
  }, [apiBase]);

  // ACWR computation — data is newest-first after reverse()
  const acuteLoad = data.slice(0, 7).reduce((sum, d) => sum + d.total_load, 0) / 7;
  const chronicLoad = data.slice(0, 28).reduce((sum, d) => sum + d.total_load, 0) / 28;
  const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 1.05;

  let acwrStatus = "Sweet Spot";
  let acwrColor = "var(--color-success)";
  let acwrDesc = "Optimal training stimulus with low injury risk.";

  if (acwr > 1.5) {
    acwrStatus = "Danger Zone";
    acwrColor = "var(--color-error)";
    acwrDesc = "High acute workload spike! Significantly elevated injury risk. Consider active recovery.";
  } else if (acwr > 1.3) {
    acwrStatus = "Overreaching";
    acwrColor = "var(--color-warning)";
    acwrDesc = "Increased fitness gains but monitoring is advised. Do not spike load further.";
  } else if (acwr < 0.8) {
    acwrStatus = "Under-training";
    acwrColor = "var(--color-accent-blue-light)";
    acwrDesc = "Workload has dropped. Fitness is likely decaying. Increase volume gradually.";
  }

  const totalZoneMinutes = hrZones?.total_minutes ?? 0;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Long-Term Trends</h2>
        </header>

        <div className="page-body">
          {/* ── Bento Stats Row ── */}
          <div className="metrics-grid" style={{ marginBottom: "var(--space-4)" }}>
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Acute Workload (7d Avg)</span>
                <svg
                  className="metric-card-icon"
                  style={{ color: "var(--color-accent-cyan)" }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <div className="metric-value">{Math.round(acuteLoad * 7)}</div>
              <div className="metric-change neutral">Sum of training load</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Acute-to-Chronic Ratio (ACWR)</span>
                <svg
                  className="metric-card-icon"
                  style={{ color: acwrColor }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </div>
              <div className="metric-value" style={{ color: acwrColor }}>
                {acwr.toFixed(2)}
              </div>
              <div
                className="metric-change"
                style={{
                  background: `${acwrColor}1A`,
                  color: acwrColor,
                  fontWeight: "var(--weight-semibold)",
                }}
              >
                {acwrStatus}
              </div>
            </div>
          </div>

          {/* ── Training Load Chart + ACWR Insights ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.8fr 1fr",
              gap: "var(--space-4)",
              marginBottom: "var(--space-4)",
            }}
          >
            <div className="chart-container animate-fade-in" id="chart-trends">
              <div className="chart-header">
                <div className="chart-title">Daily Training Load History (6 Weeks)</div>
              </div>
              <div style={{ marginTop: "1rem" }}>
                {isLoading ? (
                  <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={[...data].reverse()}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis
                        dataKey="date"
                        stroke="var(--color-text-muted)"
                        fontSize={11}
                        tickFormatter={(val) => val.substring(5)}
                        axisLine={false}
                      />
                      <YAxis stroke="var(--color-text-muted)" fontSize={11} axisLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--color-bg-elevated)",
                          borderColor: "var(--border-color)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="total_load"
                        name="Training Load"
                        stroke="var(--color-accent-blue)"
                        fill="var(--color-accent-blue)"
                        fillOpacity={0.1}
                        strokeWidth={3}
                        dot={{ r: 3, fill: "var(--color-accent-blue)" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="card animate-fade-in" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-header">
                <h3 className="card-title">Training Load Insights</h3>
              </div>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: "var(--space-4)",
                }}
              >
                <div>
                  <h4
                    style={{
                      fontSize: "var(--text-base)",
                      fontWeight: "var(--weight-semibold)",
                      marginBottom: "var(--space-2)",
                      color: acwrColor,
                    }}
                  >
                    {acwrStatus} Zone
                  </h4>
                  <p
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--color-text-secondary)",
                      lineHeight: "var(--leading-relaxed)",
                    }}
                  >
                    {acwrDesc}
                  </p>
                </div>

                <div
                  style={{
                    padding: "var(--space-3)",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  <h5
                    style={{
                      fontSize: "var(--text-xs)",
                      textTransform: "uppercase",
                      color: "var(--color-text-muted)",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    Fatigue Science Reference
                  </h5>
                  <ul
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-secondary)",
                      paddingLeft: "var(--space-4)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-1)",
                    }}
                  >
                    <li><strong>0.8 – 1.3</strong>: Sweet Spot (High fitness gain, low risk)</li>
                    <li><strong>1.3 – 1.5</strong>: Overreaching zone (Use caution)</li>
                    <li><strong>&gt; 1.5</strong>: Danger Zone (Spike, double injury risk)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* ── Weekly HR Zone Breakdown ── */}
          <div className="chart-container animate-fade-in" id="chart-hr-zones">
            <div className="chart-header" style={{ marginBottom: "var(--space-4)" }}>
              <div>
                <div className="chart-title">Last 7 Days — Heart Rate Zone Distribution</div>
                {hrZones && (
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: 4 }}>
                    {hrZones.week_start} → {hrZones.week_end} &nbsp;·&nbsp; Max HR ref: {hrZones.max_hr_used} bpm &nbsp;·&nbsp; Total: {Math.round(totalZoneMinutes)} min
                  </div>
                )}
              </div>
            </div>

            {hrLoading ? (
              <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>Loading...</div>
            ) : !hrZones || totalZoneMinutes === 0 ? (
              <div
                style={{
                  padding: "var(--space-6)",
                  textAlign: "center",
                  color: "var(--color-text-muted)",
                  fontSize: "var(--text-sm)",
                  background: "rgba(255,255,255,0.02)",
                  borderRadius: "var(--radius-md)",
                  border: "1px dashed var(--border-color)",
                }}
              >
                No activities with heart rate data found for this week.
              </div>
            ) : (
              <>
                {/* Stacked progress bar */}
                <div
                  style={{
                    display: "flex",
                    height: 20,
                    borderRadius: 10,
                    overflow: "hidden",
                    marginBottom: "var(--space-5)",
                    background: "rgba(255,255,255,0.05)",
                  }}
                >
                  {hrZones.zones.map((z) => {
                    const pct = totalZoneMinutes > 0 ? (z.minutes / totalZoneMinutes) * 100 : 0;
                    if (pct === 0) return null;
                    return (
                      <div
                        key={z.zone}
                        title={`Zone ${z.zone} — ${z.label}: ${Math.round(z.minutes)} min`}
                        style={{
                          width: `${pct}%`,
                          background: ZONE_COLORS[z.zone],
                          transition: "width 0.6s ease",
                        }}
                      />
                    );
                  })}
                </div>

                {/* Zone rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {hrZones.zones.map((z) => {
                    const pct = totalZoneMinutes > 0 ? (z.minutes / totalZoneMinutes) * 100 : 0;
                    const color = ZONE_COLORS[z.zone];
                    return (
                      <div key={z.zone} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        {/* Zone badge */}
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: `${color}22`,
                            border: `2px solid ${color}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 700,
                            color,
                            flexShrink: 0,
                          }}
                        >
                          {z.zone}
                        </div>

                        {/* Label + bar */}
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                              alignItems: "baseline",
                            }}
                          >
                            <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--color-text-primary)" }}>
                              {z.label}
                            </span>
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                              {z.hr_range}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 6,
                              background: "rgba(255,255,255,0.06)",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                background: color,
                                borderRadius: 3,
                                transition: "width 0.6s ease",
                              }}
                            />
                          </div>
                        </div>

                        {/* Minutes */}
                        <div style={{ textAlign: "right", minWidth: 64, flexShrink: 0 }}>
                          <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", color }}>
                            {Math.round(z.minutes)} min
                          </div>
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                            {pct.toFixed(0)}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
