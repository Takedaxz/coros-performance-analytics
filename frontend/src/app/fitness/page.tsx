"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import MetricCard from "@/components/MetricCard";
import FitnessScoresPanel from "@/components/FitnessScoresPanel";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface FitnessTrendDay {
  date: string;
  vo2max: number | null;
  running_fitness: number | null;
  threshold_pace: number | null;
  biological_age: number | null;
}

interface RunningFitness {
  aerobicEnduranceScore: number | null;
  lactateThresholdCapacityScore: number | null;
  anaerobicEnduranceScore: number | null;
  anaerobicCapacityScore: number | null;
  lthr: number | null;
  ltsp: number | null;
  fitnessMaxHr: number | null;
  runningLevelHr: number | null;
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
  const [runningFitness, setRunningFitness] = useState<RunningFitness | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const [trendResponse, scoresResponse] = await Promise.all([
          fetch(`${apiBase}/api/dashboard/fitness-trend?days=180`),
          fetch(`${apiBase}/api/dashboard/running-fitness`),
        ]);
        if (trendResponse.ok) {
          const json = await trendResponse.json();
          const valid = json.filter((d: FitnessTrendDay) => d.vo2max != null || d.running_fitness != null);
          setData(valid);
        }
        if (scoresResponse.ok) setRunningFitness(await scoresResponse.json());
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, []);

  const latestVo2 = [...data].reverse().find((d) => d.vo2max != null)?.vo2max || 54.2;
  const latestFitness = [...data].reverse().find((d) => d.running_fitness != null)?.running_fitness || 81;
  const latestThreshold = [...data].reverse().find((d) => d.threshold_pace != null)?.threshold_pace || null;
  const latestBioAge = [...data].reverse().find((d) => d.biological_age != null)?.biological_age || 18;
  const vo2Readings = data.filter((d): d is FitnessTrendDay & { vo2max: number } => d.vo2max !== null);
  const vo2Change = vo2Readings.length > 1 ? latestVo2 - vo2Readings[0].vo2max : null;

  const t1k = latestThreshold ? latestThreshold * 0.82 : (4.0 * 60 * (50 / latestVo2));
  const t3k = latestThreshold ? latestThreshold * 0.91 * 3 : (12.0 * 60 * (50 / latestVo2));
  const t5k = latestThreshold ? latestThreshold * 0.94 * 5 : (20.0 * 60 * (50 / latestVo2));
  const t10k = latestThreshold ? latestThreshold * 0.98 * 10 : (41.5 * 60 * (50 / latestVo2) * 1.02);
  const tHalf = latestThreshold ? latestThreshold * 1.02 * 21.0975 : (92.0 * 60 * (50 / latestVo2) * 1.05);
  const tFull = latestThreshold ? latestThreshold * 1.07 * 42.195 : (192.0 * 60 * (50 / latestVo2) * 1.10);
  const trainingThreshold = latestThreshold ?? 1;
  const predictions = [
    { label: "1K", seconds: t1k, distance: 1_000 },
    { label: "3K", seconds: t3k, distance: 3_000 },
    { label: "5K", seconds: t5k, distance: 5_000 },
    { label: "10K", seconds: t10k, distance: 10_000 },
    { label: "Half Marathon", seconds: tHalf, distance: 21_097.5 },
    { label: "Marathon", seconds: tFull, distance: 42_195 },
  ];
  const danielsZones = [
    { code: "@R", label: "Repetition", pace: formatPace(1000 / (trainingThreshold * 0.85)), color: "var(--color-status-critical)", glow: "rgba(255, 77, 98, 0.10)" },
    { code: "@I", label: "Interval / VO2", pace: formatPace(1000 / (trainingThreshold * 0.93)), color: "var(--color-status-moderate)", glow: "rgba(240, 211, 72, 0.10)" },
    { code: "@T", label: "Threshold", pace: formatPace(1000 / trainingThreshold), color: "var(--color-accent-primary)", glow: "rgba(33, 230, 165, 0.10)" },
    { code: "@M", label: "Marathon", pace: formatPace(1000 / (trainingThreshold * 1.07)), color: "var(--color-accent-exertion)", glow: "rgba(45, 155, 240, 0.10)" },
    { code: "@E", label: "Easy aerobic", pace: formatPace(1000 / (trainingThreshold * 1.25)), color: "var(--color-accent-sleep)", glow: "rgba(141, 171, 194, 0.10)" },
  ];
  const frielZones = [
    { code: "Z5", label: "Anaerobic", pace: `< ${formatPace(1000 / (trainingThreshold * 0.90))}`, color: "var(--color-status-critical)", glow: "rgba(255, 77, 98, 0.10)" },
    { code: "Z4", label: "Threshold", pace: `${formatPace(1000 / (trainingThreshold * 1.05))} – ${formatPace(1000 / trainingThreshold)}`, color: "var(--color-accent-primary)", glow: "rgba(33, 230, 165, 0.10)" },
    { code: "Z3", label: "Tempo", pace: `${formatPace(1000 / (trainingThreshold * 1.14))} – ${formatPace(1000 / (trainingThreshold * 1.05))}`, color: "var(--color-status-moderate)", glow: "rgba(240, 211, 72, 0.10)" },
    { code: "Z2", label: "Endurance", pace: `${formatPace(1000 / (trainingThreshold * 1.29))} – ${formatPace(1000 / (trainingThreshold * 1.14))}`, color: "var(--color-accent-exertion)", glow: "rgba(45, 155, 240, 0.10)" },
    { code: "Z1", label: "Active recovery", pace: `> ${formatPace(1000 / (trainingThreshold * 1.29))}`, color: "var(--color-accent-sleep)", glow: "rgba(141, 171, 194, 0.10)" },
  ];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Fitness Capabilities & Estimates</h2>
        </header>

        <div className="page-body">
          <div className="metrics-grid fitness-metrics-grid">
            <MetricCard
              label="Estimated VO2 Max"
              value={latestVo2.toFixed(1)}
              unit="ml/kg/min"
              accentColor="var(--color-accent-primary)"
              subtext="Elite Athletic Capacity"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              )}
            />
            <MetricCard
              label="Running Fitness Index"
              value={latestFitness}
              subtext="Pace & threshold score"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              )}
            />
            <MetricCard
              label="Biological Fitness Age"
              value={latestBioAge || "--"}
              unit="years"
              accentColor="var(--color-accent-exertion)"
              subtext="Cardiovascular age"
            />
          </div>

          <FitnessScoresPanel fitness={runningFitness} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", marginBottom: "var(--space-6)" }}>
            {/* Chart: VO2 Max Trend */}
            <div className="card" id="chart-vo2max">
              <div className="card-header">
                <span className="card-title">VO2 Max Progression (6 Months)</span>
                {vo2Readings.length > 0 && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", textAlign: "right" }}>
                    <strong className="mono" style={{ fontSize: "20px", color: "var(--color-accent-primary)" }}>{latestVo2.toFixed(1)}</strong>
                    <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                      {vo2Change === null || Math.abs(vo2Change) < 0.05 ? "Stable" : `${vo2Change > 0 ? "+" : ""}${vo2Change.toFixed(1)} over period`}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ marginTop: "var(--space-3)" }}>
                {isLoading ? (
                  <div className="skeleton" style={{ width: "100%", height: 210, borderRadius: 12 }} />
                ) : vo2Readings.length === 0 ? (
                  <div style={{ color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>No fitness data recorded in this period.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={vo2Readings}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" vertical={false} />
                      <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(val) => val.substring(5)} axisLine={false} interval="preserveStartEnd" />
                      <YAxis stroke="var(--color-text-muted)" fontSize={11} domain={['dataMin - 0.5', 'dataMax + 0.5']} axisLine={false} />
                      <Tooltip />
                      <Area type="monotone" dataKey="vo2max" name="VO2 Max" stroke="var(--color-accent-primary)" fill="none" strokeWidth={2} dot={{ r: 3, fill: "var(--color-accent-primary)" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="card">
              <span className="card-title">Race Predictor</span>
              <h3 style={{ fontSize: "20px", margin: "var(--space-1) 0", color: "var(--color-text-primary)" }}>Estimated finish times</h3>
              <p style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "var(--space-3)" }}>Running level {Math.round(latestFitness)}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "var(--space-2)" }}>
                {predictions.map((prediction) => (
                  <div
                    key={prediction.label}
                    style={{
                      background: "radial-gradient(circle at 0 0, rgba(33, 230, 165, 0.12), transparent 64%), var(--color-surface-secondary)",
                      border: "1px solid rgba(33, 230, 165, 0.12)",
                      borderRadius: "14px",
                      minWidth: 0,
                      padding: "12px",
                    }}
                  >
                    <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "11px", fontWeight: 750 }}>{prediction.label}</span>
                    <strong className="mono" style={{ display: "block", marginTop: "7px", fontSize: "22px", lineHeight: 1, color: "var(--color-text-primary)" }}>{formatRaceTime(prediction.seconds)}</strong>
                    <span style={{ display: "block", marginTop: "7px", color: "var(--color-text-secondary)", fontSize: "11px" }}>{formatPace(prediction.distance / prediction.seconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Training Paces Row */}
          {latestThreshold && (
            <div>
              <div className="training-pace-intro">
                <span className="card-title">Training pace zones</span>
              </div>
              <div className="training-pace-guide">
                {[
                  { title: "Daniels Formula", subtitle: "Training formula", zones: danielsZones },
                  { title: "Friel Zones", subtitle: "Threshold zones", zones: frielZones },
                ].map((guide) => (
                  <section className="card" key={guide.title}>
                    <div className="card-header">
                      <div>
                        <span className="card-title">{guide.title}</span>
                        <h3 style={{ color: "var(--color-text-primary)", fontSize: "15px", margin: "var(--space-1) 0 0" }}>{guide.subtitle}</h3>
                      </div>
                    </div>
                      <div className="training-pace-zone-grid">
                        {guide.zones.map((zone) => (
                          <div key={zone.code} style={{ background: `radial-gradient(circle at 0 0, ${zone.glow}, transparent 68%), var(--color-surface-secondary)`, border: `1px solid ${zone.glow}`, borderRadius: "12px", padding: "12px" }}>
                            <span className="mono" style={{ color: zone.color, fontSize: "11px", fontWeight: 700 }}>{zone.code}</span>
                            <span style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "11px", marginTop: "2px" }}>{zone.label}</span>
                            <strong className="mono" style={{ display: "block", color: "var(--color-text-primary)", fontSize: "16px", marginTop: "var(--space-2)" }}>{zone.pace}</strong>
                          </div>
                        ))}
                      </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
