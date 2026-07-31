"use client";

interface FitnessScoresPanelProps {
  fitness: {
    aerobicEnduranceScore: number | null;
    lactateThresholdCapacityScore: number | null;
    anaerobicEnduranceScore: number | null;
    anaerobicCapacityScore: number | null;
    lthr: number | null;
    ltsp: number | null;
    fitnessMaxHr: number | null;
    runningLevelHr: number | null;
  } | null;
}

function formatPace(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "--";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.round(seconds % 60).toString().padStart(2, "0")}/km`;
}

function formatBpm(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)} bpm`;
}

export default function FitnessScoresPanel({ fitness }: FitnessScoresPanelProps) {
  const scores = [
    { label: "Endurance", value: fitness?.aerobicEnduranceScore ?? null },
    { label: "Threshold", value: fitness?.lactateThresholdCapacityScore ?? null },
    { label: "Speed", value: fitness?.anaerobicEnduranceScore ?? null },
    { label: "Sprint", value: fitness?.anaerobicCapacityScore ?? null },
  ].filter((score): score is { label: string; value: number } => score.value !== null);

  if (scores.length === 0 && !fitness) return null;

  return (
    <div
      className="fitness-scores-panel hover-card"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-5)",
        marginBottom: "var(--space-6)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <div>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            RUNNING FITNESS
          </span>
          <h4 style={{ fontSize: "17px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>
            Running fitness
          </h4>
        </div>
      </div>

      {/* Score Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "var(--space-5)" }}>
        {scores.map((s) => (
          <div key={s.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>{s.label}</span>
              <strong style={{ color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{s.value.toFixed(1)}</strong>
            </div>
            <div style={{ height: "6px", width: "100%", background: "var(--color-overlay-soft)", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, s.value))}%`, height: "100%", background: "var(--color-accent-primary)", transition: "width 600ms ease-out" }} />
            </div>
          </div>
        ))}
      </div>

      {/* Threshold Parameters Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "8px",
          borderTop: "1px solid var(--border-color)",
          paddingTop: "var(--space-3)",
        }}
      >
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            LTHR
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>{formatBpm(fitness?.lthr ?? null)}</p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            LT PACE
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-accent-primary)", marginTop: "2px" }}>{formatPace(fitness?.ltsp ?? null)}</p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            MAX HR
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>{formatBpm(fitness?.fitnessMaxHr ?? null)}</p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            RUN LEVEL HR
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>{formatBpm(fitness?.runningLevelHr ?? null)}</p>
        </div>
      </div>
    </div>
  );
}
