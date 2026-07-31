"use client";

import React from "react";

interface CorosConnectionBarProps {
  authenticated?: boolean;
  userId?: string;
  region?: string;
  onRefresh?: () => void;
}

export default function CorosConnectionBar({
  authenticated = true,
  userId = "COROS-ATHLETE-8821",
  region = "US-EAST / GLOBAL",
  onRefresh,
}: CorosConnectionBarProps) {
  return (
    <div
      style={{
        background: "linear-gradient(90deg, rgba(33, 230, 165, 0.08) 0%, var(--color-bg-secondary) 100%)",
        border: "1px solid rgba(33, 230, 165, 0.2)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3) var(--space-5)",
        marginBottom: "var(--space-5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: authenticated ? "#21E6A5" : "#FF4D62",
            boxShadow: authenticated ? "0 0 10px #21E6A5" : "none",
          }}
        />
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          COROS Training Hub
        </span>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: "var(--color-accent-primary)",
            background: "rgba(33, 230, 165, 0.12)",
            border: "1px solid rgba(33, 230, 165, 0.25)",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {authenticated ? "Authenticated" : "Offline"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        <span>
          User ID: <strong style={{ color: "var(--color-text-primary)" }}>{userId}</strong>
        </span>
        <span style={{ borderLeft: "1px solid var(--border-color)", paddingLeft: "16px" }}>
          Region: <strong style={{ color: "var(--color-text-primary)" }}>{region}</strong>
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="btn btn-ghost btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 8px" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Sync
          </button>
        )}
      </div>
    </div>
  );
}
