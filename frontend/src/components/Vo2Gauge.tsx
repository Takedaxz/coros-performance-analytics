"use client";

import React from "react";

interface Vo2GaugeProps {
  score: number | null;
  minScore?: number;
  maxScore?: number;
  title?: string;
  subtitle?: string;
  runningFitness?: number | null;
  baseline?: number | null;
  updatedDate?: string;
  trendText?: string;
}

export default function Vo2Gauge({
  score,
  minScore = 30,
  maxScore = 75,
  title = "VO2 MAX",
  subtitle = "Running engine",
  runningFitness,
  baseline,
  updatedDate,
  trendText,
}: Vo2GaugeProps) {
  const hasScore = score !== null;
  const gaugeScore = score ?? minScore;
  // Normalize score between 0 and 1
  const pct = Math.min(Math.max((gaugeScore - minScore) / (maxScore - minScore), 0), 1);
  const angle = -180 + pct * 180; // Angle from -180 to 0 degrees

  // SVG Gauge calculations
  const size = 200;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2 + 10;

  // Calculate indicator dot position on the outer arc
  const rad = (angle * Math.PI) / 180;
  const dotX = cx + radius * Math.cos(rad);
  const dotY = cy + radius * Math.sin(rad);

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
        position: "relative",
      }}
    >
      {/* Card Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {title}
          </span>
          <h4 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>
            {subtitle}
          </h4>
        </div>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(45, 155, 240, 0.12)", color: "var(--color-accent-exertion)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        </div>
      </div>

      {/* Semi-circular Gauge Arc with Glowing Arc Marker (No Text Overlap!) */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", margin: "var(--space-2) 0" }}>
        <svg width={size} height={size / 2 + 25} viewBox={`0 0 ${size} ${size / 2 + 25}`}>
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FF4D62" />
              <stop offset="35%" stopColor="#F0D348" />
              <stop offset="70%" stopColor="#38DF64" />
              <stop offset="100%" stopColor="#2D9BF0" />
            </linearGradient>
            <filter id="dotGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Arc Track */}
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Color Gradient Arc */}
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {hasScore && <><circle cx={dotX} cy={dotY} r="8" fill="#F5F7F7" stroke="#070A0C" strokeWidth="2" filter="url(#dotGlow)" /><circle cx={dotX} cy={dotY} r="4" fill="#21E6A5" /></>}

          {/* Unobscured Score Display */}
          <text
            x={cx}
            y={cy - 12}
            textAnchor="middle"
            fill="var(--color-text-primary)"
            fontSize="38"
            fontWeight="800"
            fontFamily="var(--font-body)"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
          >
            {hasScore ? (score % 1 !== 0 ? score.toFixed(1) : score) : "--"}
          </text>

          {/* Subtext Trend Label */}
          <text
            x={cx}
            y={cy + 8}
            textAnchor="middle"
            fill="var(--color-status-positive)"
            fontSize="11"
            fontWeight="700"
            fontFamily="var(--font-body)"
          >
            {trendText ?? "No 30d baseline"}
          </text>
        </svg>
      </div>

      {/* Footer Metrics */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "8px",
          borderTop: "1px solid var(--border-color)",
          paddingTop: "var(--space-3)",
          marginTop: "auto",
        }}
      >
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            RUN FITNESS
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>{runningFitness?.toFixed(1) ?? "--"}</p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            30D AVG
          </span>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginTop: "2px" }}>{baseline?.toFixed(1) ?? "--"}</p>
        </div>
        <div>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            UPDATED
          </span>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)", marginTop: "2px" }}>{updatedDate ?? "--"}</p>
        </div>
      </div>
    </div>
  );
}
