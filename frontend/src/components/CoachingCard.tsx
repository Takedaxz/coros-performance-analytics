"use client";

import React from "react";

interface CoachingCardProps {
  title?: string;
  statusText: string;
  reasonText: string;
  recommendationText: string;
  accentColor?: string;
}

export default function CoachingCard({
  title = "PERSONAL HEALTH INTELLIGENCE",
  statusText,
  reasonText,
  recommendationText,
  accentColor = "#21E6A5",
}: CoachingCardProps) {
  return (
    <div
      style={{
        background: "linear-gradient(135deg, var(--color-bg-tertiary) 0%, var(--color-bg-secondary) 100%)",
        border: "1px solid var(--border-color)",
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-6)",
        marginBottom: "var(--space-6)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Header Tag Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-3)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "3px 10px",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-overlay-subtle)",
            border: "1px solid var(--border-color)",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: accentColor,
              boxShadow: `0 0 8px ${accentColor}`,
            }}
          />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-text-secondary)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
      </div>

      {/* Main Status Headline */}
      <h3
        style={{
          fontSize: "19px",
          fontWeight: 700,
          color: "var(--color-text-primary)",
          marginBottom: "var(--space-4)",
          letterSpacing: "-0.01em",
          lineHeight: 1.3,
        }}
      >
        {statusText}
      </h3>

      {/* Rationale & Action Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--space-4)",
          background: "var(--color-overlay-faint)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-overlay-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--color-text-muted)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              paddingTop: "2px",
              minWidth: "48px",
            }}
          >
            Why:
          </div>
          <div style={{ fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
            {reasonText}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: accentColor,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              paddingTop: "2px",
              minWidth: "48px",
            }}
          >
            Action:
          </div>
          <div style={{ fontSize: "14px", color: "var(--color-text-primary)", fontWeight: 500, lineHeight: 1.5 }}>
            {recommendationText}
          </div>
        </div>
      </div>
    </div>
  );
}
