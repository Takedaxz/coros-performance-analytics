"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import SingleSelect from "@/components/SingleSelect";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface TrainingLoadDay {
  date: string;
  total_load: number;
}

interface DistributionEntry {
  index: number;
  ratio?: number;
  value?: number;
}

interface RpeBucket {
  level: number;
  frequency: number;
  srpe: number;
  time_seconds: number;
}

interface TrainingDistributions {
  hr_training_load?: DistributionEntry[];
  hr_distance?: DistributionEntry[];
  hr_time?: DistributionEntry[];
  distance_frequency?: DistributionEntry[];
  distance_training_load?: DistributionEntry[];
  distance_time?: DistributionEntry[];
  rpe?: { buckets: RpeBucket[]; coverage: { rated: number; total: number } };
}

interface Segment {
  label: string;
  value: number;
  percent: number;
  detail: string;
  color: string;
}

const HR_COLORS = ["#ffd0d6", "#ff929f", "#ff6f80", "#ff5063", "#d14251", "#6f7487"];
const DISTANCE_COLORS = ["#8fd4ef", "#4fc3f3", "#2fb2e5", "#1f9cc9", "#1684ad", "#6f7487"];
const RPE_COLORS = ["#8fd48f", "#c9d879", "#f2c14e", "#f08a4b", "#e5563f"];
const DISTANCE_LABELS = ["0–5 km", "5–10 km", "10–20 km", "20–40 km", "40+ km"];
const RPE_LABELS = ["RPE 1 · Very light", "RPE 2 · Light", "RPE 3 · Moderate", "RPE 4 · Hard", "RPE 5 · Very hard"];

function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return `${Math.round(seconds / 60)} min`;
}

function recentLoad(data: TrainingLoadDay[], days: number): number {
  const loads = new Map(data.map((day) => [day.date, day.total_load]));
  let total = 0;
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - offset);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    total += loads.get(key) ?? 0;
  }
  return total;
}

function addSevenDayAverage<T extends { date: string }>(
  data: T[],
  getValue: (day: T) => number | null,
): Array<T & { moving_average_7d: number | null }> {
  return data.map((day, index) => {
    if (index < 6) return { ...day, moving_average_7d: null };
    const values = data.slice(index - 6, index + 1).map(getValue);
    return {
      ...day,
      moving_average_7d: values.some((value) => value === null)
        ? null
        : Math.round(values.reduce((sum, value) => sum + (value as number), 0) / values.length),
    };
  });
}

function fillTrainingLoadGaps(data: TrainingLoadDay[], historyDays: number): TrainingLoadDay[] {
  if (data.length === 0) return [];
  const loads = new Map(data.map((day) => [day.date, day.total_load]));
  const last = new Date();
  last.setHours(0, 0, 0, 0);
  const current = new Date(last);
  current.setDate(current.getDate() - historyDays);
  const result: TrainingLoadDay[] = [];

  while (current <= last) {
    const date = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    result.push({ date, total_load: loads.get(date) ?? 0 });
    current.setDate(current.getDate() + 1);
  }
  return result;
}

function zoneSegments(
  entries: DistributionEntry[],
  labels: string[],
  colors: string[],
  formatValue: (value: number) => string,
): Segment[] {
  const total = entries.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  return entries.map((entry, position) => {
    const value = entry.value ?? 0;
    return {
      label: labels[position] ?? `Zone ${entry.index}`,
      value,
      percent: entry.ratio ?? (total > 0 ? (value / total) * 100 : 0),
      detail: formatValue(value),
      color: colors[position % colors.length],
    };
  });
}

function DistributionPanel({
  eyebrow,
  title,
  value,
  onChange,
  options,
  segments,
  coverage,
  emptyMessage,
}: {
  eyebrow: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  segments: Segment[];
  coverage?: string;
  emptyMessage: string;
}) {
  const primary = [...segments].sort((left, right) => right.percent - left.percent)[0];

  return (
    <section className="card" style={{ minWidth: 0 }}>
      <div className="card-header" style={{ minHeight: "78px", alignItems: "flex-start", gap: "var(--space-3)" }}>
        <div>
          <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {eyebrow}
          </span>
          <span className="card-title" style={{ display: "block", marginTop: "4px" }}>{title} <span style={{ color: "var(--color-text-muted)" }}>(4 Weeks)</span></span>
          {coverage && <span style={{ display: "block", marginTop: "5px", fontSize: "12px", color: "var(--color-text-secondary)" }}>{coverage}</span>}
        </div>
        <SingleSelect
          ariaLabel={`${eyebrow} metric`}
          value={value}
          onChange={onChange}
          options={options}
        />
      </div>

      {segments.length === 0 ? (
        <p style={{ marginTop: "var(--space-6)", color: "var(--color-text-muted)", fontSize: "13px" }}>{emptyMessage}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(145px, 0.8fr) minmax(0, 1.2fr)", gap: "var(--space-4)", alignItems: "center", marginTop: "var(--space-5)" }}>
          <div style={{ minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={164}>
              <PieChart>
                <Pie data={segments.filter((segment) => segment.percent > 0)} dataKey="percent" nameKey="label" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="transparent">
                  {segments.filter((segment) => segment.percent > 0).map((segment) => <Cell key={segment.label} fill={segment.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#192126", border: "1px solid var(--border-color)", borderRadius: 12 }} formatter={(amount) => `${Number(amount).toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
            {primary && (
              <div style={{ marginTop: "-8px", textAlign: "center" }}>
                <span style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Primary</span>
                <strong style={{ display: "block", marginTop: "3px", fontSize: "17px" }}>{primary.label}</strong>
                <strong style={{ display: "block", marginTop: "3px", color: primary.color, fontSize: "24px", fontVariantNumeric: "tabular-nums" }}>{primary.percent.toFixed(1)}%</strong>
                <span style={{ display: "block", marginTop: "2px", color: "var(--color-text-secondary)", fontSize: "12px" }}>{primary.detail}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
            {segments.map((segment) => (
              <div key={segment.label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "8px", alignItems: "center" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", color: "var(--color-text-secondary)" }}>{segment.label}</span>
                <strong style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>{segment.detail}</strong>
                <span style={{ gridColumn: "1 / -1", height: "5px", borderRadius: "999px", overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                  <span style={{ display: "block", width: `${Math.max(segment.percent, segment.percent > 0 ? 4 : 0)}%`, height: "100%", borderRadius: "inherit", background: segment.color }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface DailyHealthDay {
  date: string;
  steps: number | null;
  active_calories_kcal: number | null;
  resting_hr_bpm?: number | null;
}

export default function TrendsPage() {
  const [data, setData] = useState<TrainingLoadDay[]>([]);
  const [dailyHealthData, setDailyHealthData] = useState<DailyHealthDay[]>([]);
  const [distributions, setDistributions] = useState<TrainingDistributions>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isHealthLoading, setIsHealthLoading] = useState(true);
  const [distributionsLoading, setDistributionsLoading] = useState(true);
  const [hrMetric, setHrMetric] = useState("training_load");
  const [distanceMetric, setDistanceMetric] = useState("frequency");
  const [rpeMetric, setRpeMetric] = useState("frequency");
  const [visibleTrendDays, setVisibleTrendDays] = useState(30);
  const trendHistoryDays = visibleTrendDays + 6;
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    async function fetchTrendData() {
      try {
        const response = await fetch(`${apiBase}/api/dashboard/training-load?days=${trendHistoryDays}`);
        if (response.ok) setData(await response.json());
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    }

    async function fetchDistributions() {
      try {
        const response = await fetch(`${apiBase}/api/dashboard/training-distributions`);
        if (response.ok) setDistributions(await response.json());
      } catch (error) {
        console.error(error);
      } finally {
        setDistributionsLoading(false);
      }
    }

    void fetchTrendData();
    void fetchDistributions();
  }, [apiBase, trendHistoryDays]);

  useEffect(() => {
    async function fetchDailyHealthTrends() {
      setIsHealthLoading(true);
      try {
        const response = await fetch(`${apiBase}/api/dashboard/daily-health-trends?days=${trendHistoryDays}`);
        if (response.ok) setDailyHealthData(await response.json());
      } catch (error) {
        console.error(error);
      } finally {
        setIsHealthLoading(false);
      }
    }
    void fetchDailyHealthTrends();
  }, [apiBase, trendHistoryDays]);

  const hrEntries = distributions[`hr_${hrMetric}` as "hr_training_load" | "hr_distance" | "hr_time"] ?? [];
  const hrSegments = zoneSegments(hrEntries, ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5", "Zone 6"], HR_COLORS, (value) => hrMetric === "distance" ? `${(value / 1000).toFixed(1)} km` : hrMetric === "time" ? formatDuration(value) : `${Math.round(value)}`);
  const distanceEntries = distributions[`distance_${distanceMetric}` as "distance_frequency" | "distance_training_load" | "distance_time"] ?? [];
  const distanceSegments = zoneSegments(distanceEntries, DISTANCE_LABELS, DISTANCE_COLORS, (value) => distanceMetric === "frequency" ? `${Math.round(value)} runs` : distanceMetric === "time" ? formatDuration(value) : `${Math.round(value)}`);
  const rpeBuckets = distributions.rpe?.buckets ?? [];
  const rpeTotal = rpeBuckets.reduce((sum, bucket) => sum + (rpeMetric === "srpe" ? bucket.srpe : rpeMetric === "time" ? bucket.time_seconds : bucket.frequency), 0);
  const rpeSegments: Segment[] = rpeTotal > 0 ? rpeBuckets.map((bucket, index) => {
    const value = rpeMetric === "srpe" ? bucket.srpe : rpeMetric === "time" ? bucket.time_seconds : bucket.frequency;
    return { label: RPE_LABELS[index], value, percent: rpeTotal > 0 ? (value / rpeTotal) * 100 : 0, detail: rpeMetric === "srpe" ? `${Math.round(value)}` : rpeMetric === "time" ? formatDuration(value) : `${Math.round(value)} sessions`, color: RPE_COLORS[index] };
  }) : [];
  const rpeCoverage = distributions.rpe ? `${distributions.rpe.coverage.rated} rated / ${distributions.rpe.coverage.total} sessions` : undefined;
  const acuteLoad = recentLoad(data, 7);
  const chronicLoad = recentLoad(data, 28);
  const acwr = chronicLoad > 0 ? (acuteLoad / 7) / (chronicLoad / 28) : null;
  const acwrStatus = acwr === null ? "No baseline" : acwr > 1.5 ? "High load" : acwr > 1.3 ? "Overreaching" : acwr < 0.8 ? "Low load" : "Sweet spot";
  const acwrColor = acwr === null ? "var(--color-text-muted)" : acwr > 1.5 ? "var(--color-status-critical)" : acwr > 1.3 ? "var(--color-status-moderate)" : acwr < 0.8 ? "var(--color-status-info)" : "var(--color-status-positive)";
  const loadChartData = addSevenDayAverage(
    fillTrainingLoadGaps(data, trendHistoryDays),
    (day) => day.total_load,
  ).slice(-visibleTrendDays);
  const stepsChartData = addSevenDayAverage(dailyHealthData, (day) => day.steps)
    .slice(-visibleTrendDays);
  const caloriesChartData = addSevenDayAverage(dailyHealthData, (day) => day.active_calories_kcal)
    .slice(-visibleTrendDays);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Training Trends</h2>
          <SingleSelect
            ariaLabel="Training trend period"
            value={String(visibleTrendDays)}
            onChange={(value) => setVisibleTrendDays(Number(value))}
            id="period-selector"
            options={[7, 14, 30, 60, 90].map((period) => ({ value: String(period), label: `${period} days` }))}
          />
        </header>
        <div className="page-body">
          {/* Training Load History */}
          <section className="card" id="chart-trends" style={{ marginBottom: "var(--space-6)" }}>
            <div className="card-header" style={{ alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <span className="card-title">Training Load History</span>
              {isLoading ? (
                <span className="skeleton" style={{ width: "140px", height: "26px", borderRadius: "999px" }} />
              ) : (
                <div className="acwr-badge-container">
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "7px",
                      padding: "5px 10px",
                      borderRadius: "999px",
                      color: acwrColor,
                      background: "var(--color-surface-secondary)",
                      border: `1px solid ${acwrColor}`,
                      fontSize: "11px",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>ACWR</span>
                    <strong>{acwr?.toFixed(2) ?? "--"}</strong>
                    <span>{acwrStatus}</span>
                  </span>

                  {/* Interactive ACWR Ranges Hover Popup */}
                  <div className="acwr-popup-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 750, color: "var(--color-text-primary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        ACWR Workload Ratio
                      </span>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: acwrColor, background: "rgba(255, 255, 255, 0.06)", padding: "2px 8px", borderRadius: "6px" }}>
                        {acwr?.toFixed(2) ?? "--"} ({acwrStatus})
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px", background: "rgba(255, 255, 255, 0.03)", padding: "8px", borderRadius: "8px" }}>
                      <div>
                        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>7d Fatigue (Acute)</span>
                        <div style={{ fontSize: "13px", fontWeight: 750, color: "var(--color-text-primary)" }}>{Math.round(acuteLoad / 7)} <span style={{ fontSize: "10px", color: "var(--color-text-muted)", fontWeight: 500 }}>/day</span></div>
                      </div>
                      <div>
                        <span style={{ fontSize: "10px", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>28d Fitness (Chronic)</span>
                        <div style={{ fontSize: "13px", fontWeight: 750, color: "var(--color-text-primary)" }}>{Math.round(chronicLoad / 28)} <span style={{ fontSize: "10px", color: "var(--color-text-muted)", fontWeight: 500 }}>/day</span></div>
                      </div>
                    </div>

                    <p style={{ fontSize: "10.5px", color: "var(--color-text-muted)", lineHeight: 1.4, marginBottom: "12px" }}>
                      Compares recent 7-day training fatigue against your 28-day fitness baseline to prevent injury and manage load progression.
                    </p>

                    {/* Gradient Scale Bar with Indicator Dot */}
                    <div style={{ position: "relative", height: "8px", borderRadius: "4px", background: "linear-gradient(to right, #4fc3f3 0%, #4fc3f3 32%, #38DF64 32%, #38DF64 68%, #F0D348 68%, #F0D348 80%, #FF4D62 80%, #FF4D62 100%)", marginBottom: "14px" }}>
                      {acwr != null && (
                        <div
                          style={{
                            position: "absolute",
                            top: "-3px",
                            left: `${Math.min(Math.max((acwr / 2.0) * 100, 2), 98)}%`,
                            transform: "translateX(-50%)",
                            width: "14px",
                            height: "14px",
                            borderRadius: "50%",
                            background: "#ffffff",
                            border: `2px solid ${acwrColor}`,
                            boxShadow: "0 2px 6px rgba(0, 0, 0, 0.6)",
                          }}
                        />
                      )}
                    </div>

                    {/* Range Breakdown Legend */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "11px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", borderRadius: "6px", background: acwr != null && acwr < 0.8 ? "rgba(79, 195, 243, 0.14)" : "transparent" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#4fc3f3", fontWeight: 700 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: "#4fc3f3" }} />
                          &lt; 0.80
                        </span>
                        <span style={{ fontWeight: 650, color: acwr != null && acwr < 0.8 ? "#4fc3f3" : "var(--color-text-muted)" }}>Low Load (Undertraining)</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", borderRadius: "6px", background: acwr != null && acwr >= 0.8 && acwr <= 1.3 ? "rgba(56, 223, 100, 0.14)" : "transparent" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38DF64", fontWeight: 700 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: "#38DF64" }} />
                          0.80 – 1.30
                        </span>
                        <span style={{ fontWeight: 650, color: acwr != null && acwr >= 0.8 && acwr <= 1.3 ? "#38DF64" : "var(--color-text-muted)" }}>Sweet Spot (Optimal Zone)</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", borderRadius: "6px", background: acwr != null && acwr > 1.3 && acwr <= 1.5 ? "rgba(240, 211, 72, 0.14)" : "transparent" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#F0D348", fontWeight: 700 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: "#F0D348" }} />
                          1.30 – 1.50
                        </span>
                        <span style={{ fontWeight: 650, color: acwr != null && acwr > 1.3 && acwr <= 1.5 ? "#F0D348" : "var(--color-text-muted)" }}>Overreaching (High Fatigue)</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", borderRadius: "6px", background: acwr != null && acwr > 1.5 ? "rgba(255, 77, 98, 0.14)" : "transparent" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#FF4D62", fontWeight: 700 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: "#FF4D62" }} />
                          &gt; 1.50
                        </span>
                        <span style={{ fontWeight: 650, color: acwr != null && acwr > 1.5 ? "#FF4D62" : "var(--color-text-muted)" }}>High Load (Injury Risk Zone)</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: "var(--space-3)" }}>
              {isLoading ? (
                <div className="skeleton" style={{ width: "100%", height: 300, borderRadius: 12 }} />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={loadChartData}>
                    <defs><linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-accent-exertion)" stopOpacity={0.3} /><stop offset="95%" stopColor="var(--color-accent-exertion)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                    <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(value) => value.substring(5)} axisLine={false} />
                    <YAxis stroke="var(--color-text-muted)" fontSize={11} axisLine={false} />
                    <Tooltip contentStyle={{ background: "#192126", border: "1px solid var(--border-color)", borderRadius: 12 }} />
                    <Area type="monotone" dataKey="total_load" name="Training Load" stroke="var(--color-accent-exertion)" fill="url(#loadGrad)" strokeWidth={2} dot={{ r: 3, fill: "var(--color-accent-exertion)" }} />
                    <Area type="monotone" dataKey="moving_average_7d" name="7-day average" stroke="var(--color-text-secondary)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Daily Activity Volume Section — Two Separated Graphs */}
          <div style={{ marginBottom: "var(--space-6)" }}>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-5)" }}>
              {/* Left Graph: Daily Steps */}
              <section className="card" id="chart-daily-steps" style={{ minWidth: 0 }}>
                <div className="card-header">
                  <span className="card-title">Daily Steps</span>
                </div>
                <div style={{ marginTop: "var(--space-4)" }}>
                  {isHealthLoading ? (
                    <div className="skeleton" style={{ width: "100%", height: 260, borderRadius: 12 }} />
                  ) : dailyHealthData.length === 0 ? (
                    <div style={{ color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>No steps recorded yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={stepsChartData}>
                        <defs>
                          <linearGradient id="stepsGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4fc3f3" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#4fc3f3" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                        <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(value) => value.substring(5)} axisLine={false} />
                        <YAxis stroke="#4fc3f3" fontSize={11} axisLine={false} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ background: "#192126", border: "1px solid var(--border-color)", borderRadius: 12 }}
                          formatter={(val: any, name: any) => [val != null ? Math.round(Number(val)).toLocaleString() : "No Data", String(name)]}
                        />
                        <Area type="monotone" dataKey="steps" name="Daily Steps" stroke="#4fc3f3" fill="url(#stepsGrad)" strokeWidth={2} connectNulls={true} dot={{ r: 3, fill: "#4fc3f3" }} />
                        <Area type="monotone" dataKey="moving_average_7d" name="7-day average" stroke="var(--color-text-secondary)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              {/* Right Graph: Active Calories */}
              <section className="card" id="chart-active-calories" style={{ minWidth: 0 }}>
                <div className="card-header">
                  <span className="card-title">Active Calories</span>
                </div>
                <div style={{ marginTop: "var(--space-4)" }}>
                  {isHealthLoading ? (
                    <div className="skeleton" style={{ width: "100%", height: 260, borderRadius: 12 }} />
                  ) : dailyHealthData.length === 0 ? (
                    <div style={{ color: "var(--color-text-muted)", padding: "2rem", textAlign: "center" }}>No active calories recorded yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={caloriesChartData}>
                        <defs>
                          <linearGradient id="calGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ff9800" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#ff9800" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                        <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickFormatter={(value) => value.substring(5)} axisLine={false} />
                        <YAxis stroke="#ff9800" fontSize={11} axisLine={false} />
                        <Tooltip
                          contentStyle={{ background: "#192126", border: "1px solid var(--border-color)", borderRadius: 12 }}
                          formatter={(val: any, name: any) => [val != null ? `${Math.round(Number(val)).toLocaleString()} kcal` : "No Data", String(name)]}
                        />
                        <Area type="monotone" dataKey="active_calories_kcal" name="Active Calories" stroke="#ff9800" fill="url(#calGrad)" strokeWidth={2} connectNulls={true} dot={{ r: 3, fill: "#ff9800" }} />
                        <Area type="monotone" dataKey="moving_average_7d" name="7-day average" stroke="var(--color-text-secondary)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>
            </div>
          </div>

          {distributionsLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-5)" }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card" style={{ height: 220, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="skeleton" style={{ width: "40%", height: 14, borderRadius: 4 }} />
                  <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: 8 }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--space-5)" }}>
              <DistributionPanel eyebrow="Threshold Heart Rate" title="Training Load" value={hrMetric} onChange={setHrMetric} options={[{ value: "training_load", label: "Training Load" }, { value: "distance", label: "Distance" }, { value: "time", label: "Time" }]} segments={hrSegments} emptyMessage="No COROS heart-rate zone distribution after the latest sync." />
              <DistributionPanel eyebrow="Distance Zones" title="Distribution" value={distanceMetric} onChange={setDistanceMetric} options={[{ value: "frequency", label: "Frequency" }, { value: "training_load", label: "Training Load" }, { value: "time", label: "Time" }]} segments={distanceSegments} emptyMessage="No COROS distance distribution after the latest sync." />
              <DistributionPanel eyebrow="Perceived Effort" title="RPE" value={rpeMetric} onChange={setRpeMetric} options={[{ value: "frequency", label: "Frequency" }, { value: "srpe", label: "sRPE" }, { value: "time", label: "Time" }]} segments={rpeSegments} coverage={rpeCoverage} emptyMessage="No RPE-rated sessions in the latest 4-week sync." />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
