"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { getSportVisual, SportIcon } from "@/components/SportActivityIcon";
import type { ActivitySummary } from "@/lib/types";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatPace(speedMps: number, sport: string): string {
  if (speedMps <= 0) return "--";
  if (sport === "swim") {
    const seconds = 100 / speedMps;
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}/100m`;
  }
  if (sport === "ride" || sport === "multisport") return `${(speedMps * 3.6).toFixed(1)} km/h`;
  const seconds = 1000 / speedMps;
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}/km`;
}

const SPORT_LABELS: Record<string, string> = {
  run: "Run",
  trail_run: "Trail Run",
  ride: "Ride",
  swim: "Swim",
  hike: "Hike",
  walk: "Walk",
  strength: "Strength",
  multisport: "Multisport",
  other: "Other",
};

function getActivityInsight(activity: { sport: string; training_load_vendor?: number; avg_hr_bpm?: number }): string {
  const load = activity.training_load_vendor ?? 0;
  const hr = activity.avg_hr_bpm;
  const sport = activity.sport?.toLowerCase() ?? "";

  if (sport === "strength") {
    return load > 120 ? "High Volume Strength" : load > 60 ? "Hypertrophy & Endurance" : "Muscular Conditioning";
  }
  if (sport === "swim") {
    return load > 100 ? "High Volume Swim" : "Aerobic Swim Engine";
  }
  if (hr != null && hr > 0) {
    if (hr >= 165) return load > 120 ? "High Threshold · Peak Load" : "Threshold / Anaerobic";
    if (hr >= 150) return load > 120 ? "Aerobic Tempo · High Load" : "Zone 3 Aerobic Tempo";
    if (hr >= 130) return load > 100 ? "Solid Base Endurance" : "Zone 2 Base Building";
    return "Active Recovery";
  }
  if (load > 120) return "High Impact Training";
  if (load > 60) return "Moderate Aerobic Stimulus";
  return "Base Building";
}

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 25;

  const fetchActivities = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
      if (sportFilter) params.set("sport", sportFilter);
      const res = await fetch(`${apiBase}/api/activities/?${params}`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities);
        setTotalCount(data.total_count || 0);
      } else {
        setActivities([]);
        setTotalCount(0);
      }
    } catch {
      setActivities([]);
      setTotalCount(0);
    }
    setIsLoading(false);
  }, [sportFilter, page, limit]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const totalDistanceMeters = activities.reduce((sum, act) => sum + (act.distance_m || 0), 0);
  const totalDurationSeconds = activities.reduce((sum, act) => sum + (act.elapsed_time_s || 0), 0);
  const totalTrainingLoad = activities.reduce((sum, act) => sum + (act.training_load_vendor || 0), 0);
  const totalCalories = activities.reduce((sum, act) => sum + (act.calories_kcal || 0), 0);
  const avgLoad = activities.length > 0 ? Math.round(totalTrainingLoad / activities.length) : 0;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Activities Log</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <select
              style={{
                background: "var(--color-surface-secondary)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "6px 12px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              value={sportFilter}
              onChange={(e) => {
                setSportFilter(e.target.value);
                setPage(1);
              }}
              id="sport-filter"
            >
              <option value="">All Sports</option>
              {Object.entries(SPORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </header>

        <div className="page-body">
          {/* Overall Activity Insights Grid */}
          <div className="metrics-grid" style={{ marginBottom: "var(--space-6)" }}>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span className="card-title">Total Distance</span>
              <div className="card-value">
                {isLoading ? <span className="skeleton" style={{ display: "inline-block", width: 70, height: 26, borderRadius: 6 }} /> : (totalDistanceMeters / 1000).toFixed(1)}
                <span className="card-value-unit">km</span>
              </div>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Page total volume</span>
            </div>

            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span className="card-title">Total Duration</span>
              <div className="card-value">
                {isLoading ? <span className="skeleton" style={{ display: "inline-block", width: 70, height: 26, borderRadius: 6 }} /> : (totalDurationSeconds / 3600).toFixed(1)}
                <span className="card-value-unit">hrs</span>
              </div>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{formatDuration(totalDurationSeconds)} logged</span>
            </div>

            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span className="card-title">Total Workload</span>
              <div className="card-value">
                {isLoading ? <span className="skeleton" style={{ display: "inline-block", width: 70, height: 26, borderRadius: 6 }} /> : totalTrainingLoad}
                <span className="card-value-unit">TL</span>
              </div>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{avgLoad} TL / workout avg</span>
            </div>

            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span className="card-title">Energy Expended</span>
              <div className="card-value">
                {isLoading ? <span className="skeleton" style={{ display: "inline-block", width: 70, height: 26, borderRadius: 6 }} /> : totalCalories.toLocaleString()}
                <span className="card-value-unit">kcal</span>
              </div>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>{activities.length} workouts</span>
            </div>
          </div>

          <div className="card" id="activities-table" style={{ position: "relative" }}>
            {isLoading && activities.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "4px" }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ width: "100%", height: "64px", borderRadius: "12px" }} />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--space-12)", color: "var(--color-text-muted)" }}>
                <p style={{ fontSize: "16px", marginBottom: "var(--space-2)" }}>No activities recorded</p>
                <p style={{ fontSize: "13px" }}>Import FIT files or sync with COROS to track performance.</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {activities.map((activity) => {
                    const startedAt = new Date(activity.start_time);
                    const sportVisual = getSportVisual(activity.sport);
                    const metrics = [
                      ["Distance", activity.distance_m != null ? formatDistance(activity.distance_m) : "--"],
                      ["Duration", activity.elapsed_time_s != null ? formatDuration(activity.elapsed_time_s) : "--"],
                      ["Avg HR", activity.avg_hr_bpm != null ? `${activity.avg_hr_bpm} bpm` : "--"],
                      ["Pace", activity.avg_speed_mps != null ? formatPace(activity.avg_speed_mps, activity.sport) : "--"],
                      ["Power", activity.avg_power_w != null ? `${activity.avg_power_w} W` : "--"],
                      ["Calories", activity.calories_kcal != null ? `${activity.calories_kcal} kcal` : "--"],
                      ["Load", activity.training_load_vendor != null ? String(activity.training_load_vendor) : "--"],
                    ];

                    return (
                      <Link
                        key={activity.id}
                        href={`/activities/${activity.id}?sport=${encodeURIComponent(activity.sport)}`}
                        className="activity-card-item"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "40px minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: "14px",
                          minHeight: "64px",
                          padding: "8px 10px",
                          color: "inherit",
                          textDecoration: "none",
                          background: `radial-gradient(circle at 0 0, ${sportVisual.background}, transparent 62%), var(--color-surface-secondary)`,
                          border: `1px solid ${sportVisual.background}`,
                          borderRadius: "12px",
                        }}
                      >
                        <div
                          className="activity-sport-badge"
                          aria-label={sportVisual.label}
                          style={{ height: "40px", borderRadius: "12px", display: "flex", justifyContent: "center", alignItems: "center", background: sportVisual.background, color: sportVisual.color }}
                        >
                          <span style={{ display: "flex", transform: "scale(0.8)" }}><SportIcon sport={activity.sport} /></span>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px", fontWeight: 750 }}>
                            {activity.title || sportVisual.label}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(64px, max-content))", gap: "4px 16px", marginTop: "5px", fontVariantNumeric: "tabular-nums" }}>
                            {metrics.map(([label, value]) => (
                              <span key={label} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                <span style={{ color: "var(--color-text-muted)", fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
                                <span style={{ color: "var(--color-text-secondary)", fontSize: "10px", whiteSpace: "nowrap" }}>{value}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", color: "var(--color-text-secondary)", fontSize: "11px", fontVariantNumeric: "tabular-nums" }}>
                          <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "12px" }}>
                            {startedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </strong>
                          <span style={{ display: "block" }}>
                            {startedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {totalCount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-4)" }}>
                    <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                      Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} activities
                    </span>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                      >
                        Previous
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={page >= Math.ceil(totalCount / limit)}
                        onClick={() => setPage(p => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
