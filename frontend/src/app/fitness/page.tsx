"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import MetricCard from "@/components/MetricCard";
import FitnessScoresPanel from "@/components/FitnessScoresPanel";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface FitnessTrendDay {
  date: string;
  vo2max: number | null;
  running_fitness: number | null;
  threshold_pace: number | null;
  lthr: number | null;
  cardio_fitness_age: number | null;
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

interface GenericTooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  fill?: string;
  stroke?: string;
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
        minWidth: "165px",
      }}
    >
      <strong style={{ display: "block", marginBottom: "8px", color: "var(--color-text-secondary)", fontSize: "12px" }}>
        {label ? formatChartAxisDate(label) : ""}
      </strong>
      {payload.map((entry, idx) => {
        const itemColor = entry.stroke || entry.color || entry.fill || "var(--color-accent-primary)";
        const rawVal = entry.value;
        const valStr = rawVal == null || rawVal === "" ? "No Data" : `${typeof rawVal === "number" ? rawVal.toFixed(1) : rawVal}${unit ? ` ${unit}` : ""}`;
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
            <strong>{valStr}</strong>
          </div>
        );
      })}
    </div>
  );
}

export default function FitnessPage() {
  const [data, setData] = useState<FitnessTrendDay[]>([]);
  const [runningFitness, setRunningFitness] = useState<RunningFitness | null>(null);
  const [trendMetrics, setTrendMetrics] = useState<Array<"running_fitness" | "lthr" | "threshold_pace">>(["running_fitness"]);
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
          const valid = json.filter((d: FitnessTrendDay) => d.vo2max != null || d.running_fitness != null || d.lthr != null || d.threshold_pace != null);
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
  const latestCardioFitnessAge = [...data]
    .reverse()
    .find((day) => day.cardio_fitness_age != null)?.cardio_fitness_age ?? null;
  const vo2Readings = data.filter((d): d is FitnessTrendDay & { vo2max: number } => d.vo2max !== null);
  const vo2Change = vo2Readings.length > 1 ? latestVo2 - vo2Readings[0].vo2max : null;
  const trendOptions = [
    { key: "running_fitness" as const, label: "Running fitness", unit: "", color: "var(--color-accent-primary)", format: (value: number) => value.toFixed(1) },
    { key: "lthr" as const, label: "LTHR", unit: "bpm", color: "var(--color-accent-exertion)", format: (value: number) => `${Math.round(value)} bpm` },
    { key: "threshold_pace" as const, label: "LT pace", unit: "/km", color: "var(--color-accent-sleep)", format: (value: number) => formatPace(1000 / value) },
  ];
  const selectedTrends = trendOptions.filter((option) => trendMetrics.includes(option.key));
  const trendReadings = data.filter((day) => trendMetrics.some((metric) => day[metric] != null));
  const toggleTrendMetric = (metric: (typeof trendOptions)[number]["key"]) => {
    setTrendMetrics((current) => current.includes(metric) ? (current.length > 1 ? current.filter((item) => item !== metric) : current) : [...current, metric]);
  };

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
          <PageTitle>Fitness Capabilities & Estimates</PageTitle>
        </header>

        <div className="page-body">
          <div className="metrics-grid fitness-metrics-grid">
            <MetricCard
              label="Estimated VO2 Max"
              shortLabel="VO2 Max"
              value={latestVo2.toFixed(1)}
              unit="ml/kg/min"
              accentColor="var(--color-accent-primary)"
              subtext="Elite Athletic Capacity"
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
                  <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
                  <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
                </svg>
              )}
            />
            <MetricCard
              label="Running Fitness Index"
              shortLabel="Fitness Index"
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
              label="Cardio Fitness Age"
              shortLabel="Fitness Age"
              value={latestCardioFitnessAge ?? "--"}
              unit={latestCardioFitnessAge === null ? undefined : "years"}
              accentColor="var(--color-accent-exertion)"
              subtext={
                latestCardioFitnessAge === null
                  ? "Select sex in Settings"
                  : "Based on your 30-day average VO₂ max"
              }
              icon={(
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                  <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
                </svg>
              )}
            />
          </div>

          <FitnessScoresPanel fitness={runningFitness} />

          <section className="card activity-zone-card running-dynamics-card" style={{ marginBottom: "var(--space-6)" }}>
            <div className="activity-zone-header">
              <div>
                <span className="card-title">Running Fitness Trend</span>
              </div>
            </div>
            <div className="running-dynamics-tabs" role="group" aria-label="Running fitness trend metrics">
                {trendOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={trendMetrics.includes(option.key)}
                    onClick={() => toggleTrendMetric(option.key)}
                    className={trendMetrics.includes(option.key) ? "active" : ""}
                    style={trendMetrics.includes(option.key) ? { borderColor: option.color, color: option.color, backgroundColor: `${option.color}18` } : undefined}
                  >
                    {option.label}
                  </button>
                ))}
            </div>
            <div className="running-dynamics-legend" aria-label="Selected metric values">
              {selectedTrends.map((trend) => {
                const latest = [...trendReadings].reverse().find((day) => day[trend.key] != null)?.[trend.key];
                return <span key={trend.key}><i style={{ background: trend.color }} />{trend.label}<strong className="mono">{latest != null ? trend.format(latest) : "No data"}</strong></span>;
              })}
            </div>
            {isLoading ? (
              <div className="skeleton" style={{ width: "100%", height: 260, borderRadius: 12 }} />
            ) : trendReadings.length === 0 ? (
              <div style={{ color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>No historical data for the selected metrics yet.</div>
            ) : (
              <div className="activity-zone-chart running-dynamics-chart">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 260 }}>
                  <LineChart data={trendReadings} margin={{ top: 16, right: 12, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                    <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(value) => formatChartAxisDate(value)} axisLine={false} interval="equidistantPreserveStart" />
                    {selectedTrends.map((trend) => <YAxis key={trend.key} yAxisId={trend.key} hide domain={["dataMin - 1", "dataMax + 1"]} />)}
                    <Tooltip
                      cursor={{ stroke: "var(--color-chart-grid)" }}
                      content={({ active, label, payload }) => {
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
                              minWidth: "175px",
                            }}
                          >
                            <strong style={{ display: "block", marginBottom: "8px", color: "var(--color-text-secondary)", fontSize: "12px" }}>
                              {label ? formatChartAxisDate(String(label)) : ""}
                            </strong>
                            {payload.map((entry, idx) => {
                              const trend = trendOptions.find((option) => option.label === entry.name || option.key === entry.dataKey);
                              const itemColor = trend?.color || entry.stroke || entry.color || "var(--color-accent-primary)";
                              const rawVal = entry.value;
                              const valStr = rawVal == null || rawVal === "" ? "No data" : (trend ? trend.format(Number(rawVal)) : String(rawVal));
                              return (
                                <div
                                  key={entry.name || idx}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "16px",
                                    marginTop: idx === 0 ? 0 : "6px",
                                    fontSize: "13px",
                                  }}
                                >
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", color: "var(--color-text-secondary)" }}>
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
                                  <strong className="mono" style={{ color: "var(--color-text-primary)" }}>{valStr}</strong>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {selectedTrends.map((trend) => <Line key={trend.key} yAxisId={trend.key} type="monotone" dataKey={trend.key} name={trend.label} stroke={trend.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", marginBottom: "var(--space-6)" }}>
            {/* Chart: VO2 Max Trend */}
            <div className="card" id="chart-vo2max">
              <div className="card-header">
                <span className="card-title">VO2 Max Progression (12 Weeks)</span>
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
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" vertical={false} />
                      <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(val) => formatChartAxisDate(val)} axisLine={false} interval="equidistantPreserveStart" />
                      <YAxis stroke="var(--color-text-muted)" fontSize={11} domain={['dataMin - 0.5', 'dataMax + 0.5']} axisLine={false} />
                      <Tooltip cursor={{ fill: "var(--color-chart-cursor)" }} content={<ChartLegendTooltip unit="ml/kg/min" />} />
                      <Area type="monotone" dataKey="vo2max" name="VO2 Max" stroke="var(--color-accent-primary)" fill="none" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
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
                          <div className="training-pace-zone" key={zone.code} style={{ background: `radial-gradient(circle at 0 0, ${zone.glow}, transparent 68%), var(--color-surface-secondary)`, border: `1px solid ${zone.glow}`, borderRadius: "12px", padding: "12px" }}>
                            <span className="mono" style={{ color: zone.color, fontSize: "11px", fontWeight: 700 }}>{zone.code}</span>
                            <span className="training-pace-zone-label" style={{ display: "block", color: "var(--color-text-secondary)", fontSize: "11px", marginTop: "2px" }}>{zone.label}</span>
                            <strong className="mono training-pace-zone-value" style={{ display: "block", color: "var(--color-text-primary)", fontSize: "16px", marginTop: "var(--space-2)" }}>{zone.pace}</strong>
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
