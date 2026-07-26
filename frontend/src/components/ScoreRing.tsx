"use client";

import React, { useId } from "react";

interface ScoreRingProps {
  score?: number | null;
  maxScore?: number;
  label: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
  unit?: string;
}

export default function ScoreRing({
  score,
  maxScore = 100,
  label,
  color = "#21E6A5",
  size = 190,
  strokeWidth = 11,
  unit = "%",
}: ScoreRingProps) {
  const filterId = useId();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const hasScore = score !== null && score !== undefined;
  const normalizedScore = hasScore ? Math.min(Math.max(score, 0), maxScore) : 0;
  const strokeDashoffset = circumference - (normalizedScore / maxScore) * circumference;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        width: size,
        height: size,
      }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", overflow: "visible" }}>
        <defs>
          <filter id={`glow-${filterId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Track Background */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth={strokeWidth}
        />

        {/* Animated Active Arc with Subtle Glow */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          filter={`url(#glow-${filterId})`}
          style={{
            transition: "stroke-dashoffset 900ms cubic-bezier(0.4, 0, 0.2, 1), stroke 300ms ease",
          }}
        />
      </svg>

      {/* Inner Centered Display */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: "var(--color-text-muted)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "4px",
          }}
        >
          {label}
        </span>

        <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
          <span
            style={{
              fontSize: size > 160 ? "46px" : "34px",
              fontWeight: 800,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {hasScore
              ? normalizedScore % 1 !== 0
                ? normalizedScore.toFixed(1)
                : Math.round(normalizedScore)
              : "--"}
          </span>
          {unit && hasScore && (
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-text-muted)",
              }}
            >
              {unit}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
