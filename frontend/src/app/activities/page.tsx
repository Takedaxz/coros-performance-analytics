"use client";

import { useState, useEffect, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
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
  const s = sport.toLowerCase();
  if (s === "swim") {
    const paceSecsPer100m = 100 / speedMps;
    const min = Math.floor(paceSecsPer100m / 60);
    const sec = Math.round(paceSecsPer100m % 60);
    return `${min}:${sec.toString().padStart(2, "0")}/100m`;
  } else if (s === "ride" || s === "multisport") {
    const kmh = speedMps * 3.6;
    return `${kmh.toFixed(1)} km/h`;
  }
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
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

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 100;

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchActivities();
  }, [fetchActivities]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Activities</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <select
              className="input"
              style={{ width: 160 }}
              value={sportFilter}
              onChange={(e) => {
                setSportFilter(e.target.value);
                setPage(1); // Reset page on filter change
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
          <div className="card no-hover" id="activities-table" style={{ position: "relative" }}>
            {isLoading && activities.length > 0 && (
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(255,255,255,0.4)", backdropFilter: "blur(2px)",
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
                borderRadius: "var(--radius-lg)"
              }}>
                <div className="progress-bar" style={{ width: 200 }}>
                  <div className="progress-bar-fill" style={{ width: "100%", animation: "progress-slide 1.5s infinite ease-in-out" }} />
                </div>
              </div>
            )}
            
            {isLoading && activities.length === 0 ? (
              <div style={{ minHeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div className="progress-bar" style={{ width: 200 }}>
                  <div className="progress-bar-fill" style={{ width: "100%", animation: "progress-slide 1.5s infinite ease-in-out" }} />
                </div>
              </div>
            ) : activities.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--space-16)", color: "var(--color-text-muted)" }}>
                <p style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-3)" }}>No activities found</p>
                <p style={{ fontSize: "var(--text-sm)" }}>Import FIT/TCX files or sync with COROS to get started.</p>
                <a href="/import" className="btn btn-primary" style={{ marginTop: "var(--space-4)" }}>Import Data</a>
              </div>
            ) : (
              <>
                <div className="table-responsive table-responsive-fixed" style={{ opacity: isLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
                  <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sport</th>
                      <th>Title</th>
                      <th>Date</th>
                      <th>Distance</th>
                      <th>Duration</th>
                      <th>Avg HR</th>
                      <th>Pace</th>
                      <th>Power</th>
                      <th>Calories</th>
                      <th>Load</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a) => (
                      <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => window.location.href = `/activities/${a.id}`}>
                        <td><span className="badge badge-sport">{SPORT_LABELS[a.sport] || a.sport}</span></td>
                        <td>{a.title || "--"}</td>
                        <td className="mono">{new Date(a.start_time).toLocaleDateString("en-GB")}</td>
                        <td className="mono">{a.distance_m ? formatDistance(a.distance_m) : "--"}</td>
                        <td className="mono">{a.elapsed_time_s ? formatDuration(a.elapsed_time_s) : "--"}</td>
                        <td className="mono">{a.avg_hr_bpm || "--"}</td>
                        <td className="mono">{a.avg_speed_mps ? formatPace(a.avg_speed_mps, a.sport) : "--"}</td>
                        <td className="mono">{a.avg_power_w ? `${a.avg_power_w}W` : "--"}</td>
                        <td className="mono">{a.calories_kcal || "--"}</td>
                        <td className="mono">{a.training_load_vendor || "--"}</td>
                        <td><span className="badge badge-source">{a.source_type}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Controls */}
              {totalCount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-4)" }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
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
