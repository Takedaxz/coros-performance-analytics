"use client";

import React, { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  baselineDelta?: string;
  status?: "positive" | "negative" | "neutral";
  icon?: ReactNode;
  subtext?: string;
  accentColor?: string;
}

export default function MetricCard({
  label,
  value,
  unit,
  baselineDelta,
  status = "neutral",
  icon,
  subtext,
  accentColor,
}: MetricCardProps) {
  const getBadgeStyle = () => {
    if (status === "positive") {
      return {
        color: "var(--color-status-positive)",
        background: "rgba(56, 223, 100, 0.08)",
        border: "1px solid rgba(56, 223, 100, 0.2)",
      };
    }
    if (status === "negative") {
      return {
        color: "var(--color-status-critical)",
        background: "rgba(255, 77, 98, 0.08)",
        border: "1px solid rgba(255, 77, 98, 0.2)",
      };
    }
    return {
      color: "var(--color-text-secondary)",
      background: "var(--color-overlay-subtle)",
      border: "1px solid var(--border-color)",
    };
  };

  return (
    <div
      className="metric-card hover-card"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-4) var(--space-5)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transition: "all var(--transition-fast)",
      }}
    >
      <div>
        <div className="metric-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span className="metric-label" style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {label}
          </span>
          {icon && <span style={{ color: "var(--color-text-muted)", width: 16, height: 16, display: "flex", alignItems: "center" }}>{icon}</span>}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
          <span
            className="metric-value"
            style={{
              fontSize: "30px",
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
              color: accentColor || "var(--color-text-primary)",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
            }}
          >
            {value}
          </span>
          {unit && <span className="card-value-unit" style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-muted)" }}>{unit}</span>}
        </div>
      </div>

      {(baselineDelta || subtext) && (
        <div style={{ marginTop: "14px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: baselineDelta ? "6px" : undefined, justifyContent: baselineDelta ? "flex-start" : "space-between" }}>
          {baselineDelta ? (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                ...getBadgeStyle(),
              }}
            >
              {status === "positive" ? "↑ " : status === "negative" ? "↓ " : ""}
              {baselineDelta}
            </span>
          ) : <div />}
          {subtext && (
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              {subtext}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
