"use client";

import { useState } from "react";

interface SleepCardProps {
  dateStr: string;
  score?: number;
  statusText?: string;
  durationSeconds: number;
  deepSeconds?: number;
  remSeconds?: number;
  lightSeconds?: number;
  awakeSeconds?: number;
  awakeCount?: number;
  napSeconds?: number;
}

type SleepStage = {
  label: string;
  seconds: number;
  percentage: number;
  color: string;
};

function formatHoursMins(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SleepCard({
  dateStr,
  score,
  statusText,
  durationSeconds,
  deepSeconds = 0,
  remSeconds = 0,
  lightSeconds = 0,
  awakeSeconds = 0,
  awakeCount = 1,
  napSeconds = 0,
}: SleepCardProps) {
  const scoreStatus = statusText ?? (score == null
    ? "WAITING"
    : score < 60
      ? "POOR"
      : score < 75
        ? "FAIR"
        : score < 90
          ? "GOOD"
          : "EXCELLENT");
  const total = durationSeconds || 1;
  const deepPct = Math.round((deepSeconds / total) * 100);
  const remPct = Math.round((remSeconds / total) * 100);
  const lightPct = Math.round((lightSeconds / total) * 100);
  const awakePct = Math.max(0, 100 - deepPct - remPct - lightPct);
  const stages: SleepStage[] = [
    { label: "Deep", seconds: deepSeconds, percentage: deepPct, color: "#21E6A5" },
    { label: "Light", seconds: lightSeconds, percentage: lightPct, color: "#2D9BF0" },
    { label: "REM", seconds: remSeconds, percentage: remPct, color: "#8DABC2" },
    { label: "Awake", seconds: awakeSeconds, percentage: awakePct, color: "#4D565B" },
  ];
  const [hoveredStage, setHoveredStage] = useState<SleepStage | null>(null);

  return (
    <div
      className="hover-card"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-5)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
      }}
    >
      {/* Header */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            SLEEP RECOVERY
          </span>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(141, 171, 194, 0.12)", color: "var(--color-accent-sleep)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </div>
        </div>

        <h4 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          {dateStr}
        </h4>

        {/* Score & Main Sleep Row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "var(--space-3) 0" }}>
          <div>
            <span style={{ fontSize: "40px", fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
              {score ?? "--"}
            </span>
            <span
              style={{
                display: "inline-block",
                fontSize: "10px",
                fontWeight: 700,
                color: (score ?? 0) >= 75 ? "var(--color-status-positive)" : (score ?? 0) >= 55 ? "var(--color-status-moderate)" : "var(--color-status-critical)",
                background: (score ?? 0) >= 75 ? "rgba(56, 223, 100, 0.12)" : "rgba(240, 211, 72, 0.12)",
                padding: "2px 6px",
                borderRadius: "var(--radius-sm)",
                marginLeft: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {scoreStatus}
            </span>
          </div>

          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              MAIN SLEEP
            </span>
            <p style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
              {formatHoursMins(durationSeconds)}
            </p>
          </div>
        </div>

        {/* Multi-colored Stacked Stage Bar */}
        <div style={{ position: "relative", margin: "var(--space-3) 0 var(--space-2)" }}>
          {hoveredStage && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 9px",
                borderRadius: "8px",
                background: "var(--color-popover)",
                border: "1px solid var(--border-color)",
                color: "var(--color-text-primary)",
                fontSize: "11px",
                fontWeight: 700,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: hoveredStage.color }} />
              {hoveredStage.label}: {formatHoursMins(hoveredStage.seconds)} ({hoveredStage.percentage}%)
            </div>
          )}
          <div
            style={{
              display: "flex",
              height: "12px",
              borderRadius: "var(--radius-full)",
              overflow: "hidden",
              background: "var(--color-overlay-soft)",
            }}
          >
            {stages.filter((stage) => stage.percentage > 0).map((stage) => (
              <div
                key={stage.label}
                tabIndex={0}
                aria-label={`${stage.label}: ${formatHoursMins(stage.seconds)} (${stage.percentage}%)`}
                onMouseEnter={() => setHoveredStage(stage)}
                onMouseLeave={() => setHoveredStage(null)}
                onFocus={() => setHoveredStage(stage)}
                onBlur={() => setHoveredStage(null)}
                style={{
                  width: `${stage.percentage}%`,
                  background: stage.color,
                  opacity: hoveredStage && hoveredStage.label !== stage.label ? 0.45 : 1,
                  filter: hoveredStage?.label === stage.label ? "brightness(1.18)" : "none",
                  transition: "opacity 160ms ease, filter 160ms ease",
                }}
              />
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#21E6A5" }} /> Deep <strong>{deepPct}%</strong>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2D9BF0" }} /> Light <strong>{lightPct}%</strong>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8DABC2" }} /> REM <strong>{remPct}%</strong>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4D565B" }} /> Awake <strong>{awakePct}%</strong>
          </span>
        </div>
      </div>

      {/* Sub Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "10px",
          borderTop: "1px solid var(--border-color)",
          paddingTop: "var(--space-3)",
        }}
      >
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            AWAKE DURATION
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>
            {formatHoursMins(awakeSeconds)}
          </p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            AWAKE EVENTS
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>
            {awakeCount} times
          </p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            NAPS
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>
            {napSeconds > 0 ? formatHoursMins(napSeconds) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
