"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface FitnessTrendDay {
  date: string;
  vo2max: number | null;
  running_fitness: number | null;
  threshold_pace: number | null;
  biological_age: number | null;
}

function formatPace(speedMps: number): string {
  if (speedMps <= 0) return "--";
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

function formatRaceTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function FitnessPage() {
  const [data, setData] = useState<FitnessTrendDay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiBase}/api/dashboard/fitness-trend?days=180`);
        if (res.ok) {
          const json = await res.json();
          // Filter out days without data
          const valid = json.filter((d: FitnessTrendDay) => d.vo2max != null || d.running_fitness != null);
          setData(valid);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  // Determine active VO2 Max for race predictions
  const latestVo2 = data.find((d) => d.vo2max != null)?.vo2max || 50.4;
  const latestFitness = data.find((d) => d.running_fitness != null)?.running_fitness || 78;
  const latestThreshold = data.find((d) => d.threshold_pace != null)?.threshold_pace || null;
  const latestBioAge = data.find((d) => d.biological_age != null)?.biological_age || null;

  // Race calculations using realistic threshold pace if available, fallback to VO2 max
  const t5k = latestThreshold ? latestThreshold * 0.93 * 5 : (20.0 * 60 * (50 / latestVo2));
  const t10k = latestThreshold ? latestThreshold * 0.98 * 10 : (41.5 * 60 * (50 / latestVo2) * 1.02);
  const tHalf = latestThreshold ? latestThreshold * 1.05 * 21.0975 : (92.0 * 60 * (50 / latestVo2) * 1.05);
  const tFull = latestThreshold ? latestThreshold * 1.15 * 42.195 : (192.0 * 60 * (50 / latestVo2) * 1.10);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Fitness & Estimates</h2>
        </header>

        <div className="page-body">
          {/* Top Row: Overview Cards */}
          <div className="metrics-grid" style={{ marginBottom: "var(--space-4)" }}>
            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Estimated VO2 Max</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-emerald)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <div className="metric-value">{latestVo2.toFixed(1)}</div>
              <div className="metric-change neutral">Aesthetic Elite Tier</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Running Fitness Index</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-violet)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <div className="metric-value">{latestFitness}</div>
              <div className="metric-change neutral">Based on threshold pace</div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Biological Age</span>
                <svg className="metric-card-icon" style={{ color: "var(--color-accent-blue)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <div className="metric-value" style={{ color: latestBioAge ? "var(--color-accent-blue)" : "inherit" }}>
                {latestBioAge || "--"}
              </div>
              <div className="metric-change positive">Years Old</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "var(--space-4)" }}>
            {/* Chart: VO2 Max Trend */}
            <div className="chart-container animate-fade-in" id="chart-vo2max">
              <div className="chart-header">
                <div className="chart-title">VO2 Max Progression (6 Months)</div>
              </div>
              <div style={{ height: 320, marginTop: "1rem" }}>
                {isLoading ? (
                  <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>
                ) : data.length === 0 ? (
                  <div style={{ color: "var(--color-text-muted)" }}>No fitness data recorded in this period.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>

                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                      <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(val) => val.substring(5)} axisLine={false} />
                      <YAxis stroke="var(--color-text-muted)" fontSize={11} domain={['dataMin - 0.5', 'dataMax + 0.5']} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "var(--color-bg-elevated)", borderColor: "var(--border-color)", borderRadius: 8, fontSize: 12 }}
                      />
                      <Area type="monotone" dataKey="vo2max" name="VO2 Max" stroke="var(--color-accent-emerald)" fill="var(--color-accent-emerald)" fillOpacity={0.1} strokeWidth={3} dot={{ r: 4, fill: "var(--color-accent-emerald)" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Race Predictor Card */}
            <div className="card animate-fade-in" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card-header">
                <h3 className="card-title">Race Time Predictor</h3>
              </div>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
                Calculated estimations based on threshold and oxygen capacity levels.
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>5K</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="mono" style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: "var(--color-accent-cyan)", display: "block" }}>
                      {formatRaceTime(t5k)}
                    </span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{formatPace(5000 / t5k)}</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>10K</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="mono" style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: "var(--color-accent-cyan)", display: "block" }}>
                      {formatRaceTime(t10k)}
                    </span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{formatPace(10000 / t10k)}</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>Half Marathon</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="mono" style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: "var(--color-accent-cyan)", display: "block" }}>
                      {formatRaceTime(tHalf)}
                    </span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{formatPace(21097.5 / tHalf)}</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "var(--space-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)" }}>Marathon</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className="mono" style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: "var(--color-accent-cyan)", display: "block" }}>
                      {formatRaceTime(tFull)}
                    </span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{formatPace(42195 / tFull)}</span>
                  </div>
                </div>
              </div>
              {latestThreshold && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "var(--space-4)" }}>
                  <em>Predictions are calculated using your actual Lactate Threshold Pace for realistic target setting.</em>
                </div>
              )}
            </div>
          </div>

          {/* Training Paces Row */}
          {latestThreshold && (
            <div className="card animate-fade-in" style={{ marginTop: "var(--space-4)" }}>
              <div className="card-header">
                <h3 className="card-title">Target Training Paces</h3>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)" }}>
                
                {/* Jack Daniels */}
                <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", overflow: "hidden", backgroundColor: "var(--color-bg-card)" }}>
                  <div style={{ backgroundColor: "var(--color-bg-elevated)", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                    <h4 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: "var(--color-text)", margin: 0 }}>Daniels' Running Formula</h4>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>@R (Repetition)</span>
                      <span className="mono" style={{ color: "var(--color-accent-rose)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 0.85))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>@I (Interval / VO2)</span>
                      <span className="mono" style={{ color: "var(--color-accent-amber)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 0.93))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>@T (Threshold)</span>
                      <span className="mono" style={{ color: "var(--color-accent-emerald)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / latestThreshold)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>@M (Marathon)</span>
                      <span className="mono" style={{ color: "var(--color-accent-blue-light)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 1.15))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>@E (Easy)</span>
                      <span className="mono" style={{ color: "var(--color-accent-violet)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 1.25))}</span>
                    </div>
                  </div>
                </div>

                {/* Joe Friel */}
                <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", overflow: "hidden", backgroundColor: "var(--color-bg-card)" }}>
                  <div style={{ backgroundColor: "var(--color-bg-elevated)", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                    <h4 style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)", color: "var(--color-text)", margin: 0 }}>Friel's Triathlete's Training Bible</h4>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>Z5c (Anaerobic)</span>
                      <span className="mono" style={{ color: "var(--color-accent-rose)", fontWeight: "var(--weight-semibold)" }}>&lt; {formatPace(1000 / (latestThreshold * 0.90))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>Z5a/b (Super-Threshold)</span>
                      <span className="mono" style={{ color: "var(--color-accent-amber)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 1.00))} - {formatPace(1000 / (latestThreshold * 0.90))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>Z4 (Threshold)</span>
                      <span className="mono" style={{ color: "var(--color-accent-emerald)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 1.05))} - {formatPace(1000 / (latestThreshold * 1.00))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>Z3 (Tempo)</span>
                      <span className="mono" style={{ color: "var(--color-accent-cyan)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 1.14))} - {formatPace(1000 / (latestThreshold * 1.05))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-color)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>Z2 (Endurance)</span>
                      <span className="mono" style={{ color: "var(--color-accent-blue-light)", fontWeight: "var(--weight-semibold)" }}>{formatPace(1000 / (latestThreshold * 1.29))} - {formatPace(1000 / (latestThreshold * 1.14))}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-4)" }}>
                      <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-sm)" }}>Z1 (Recovery)</span>
                      <span className="mono" style={{ color: "var(--color-accent-violet)", fontWeight: "var(--weight-semibold)" }}>&gt; {formatPace(1000 / (latestThreshold * 1.29))}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
