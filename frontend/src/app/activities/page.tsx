"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import SingleSelect from "@/components/SingleSelect";
import NumberStepper from "@/components/NumberStepper";
import CustomDatePicker from "@/components/CustomDatePicker";
import { getSportVisual, SportIcon } from "@/components/SportActivityIcon";
import type { ActivitySummary } from "@/lib/types";

type DatePeriod = "" | "day" | "week" | "month" | "year";
type ActivitySort =
  | "newest"
  | "oldest"
  | "duration_desc"
  | "duration_asc"
  | "load_desc"
  | "load_asc"
  | "distance_desc"
  | "distance_asc";

interface ActivityFilters {
  period: DatePeriod;
  periodValue: string;
  weekday: string;
  minDurationMinutes: string;
  maxDurationMinutes: string;
  minTrainingLoad: string;
  maxTrainingLoad: string;
  minDistanceKm: string;
  maxDistanceKm: string;
  sort: ActivitySort;
}

const DEFAULT_FILTERS: ActivityFilters = {
  period: "",
  periodValue: "",
  weekday: "",
  minDurationMinutes: "",
  maxDurationMinutes: "",
  minTrainingLoad: "",
  maxTrainingLoad: "",
  minDistanceKm: "",
  maxDistanceKm: "",
  sort: "newest",
};

const PERIOD_INPUT_LABELS: Record<Exclude<DatePeriod, "">, string> = {
  day: "Exact calendar date",
  week: "Week number and year",
  month: "Month and year",
  year: "Year",
};


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
  treadmill: "Treadmill Run",
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
  const [nameFilter, setNameFilter] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [filters, setFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<ActivityFilters>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(() => {
    if (typeof window === "undefined") return 1;
    const requestedPage = Number(new URLSearchParams(window.location.search).get("page"));
    return Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  });
  const [totalCount, setTotalCount] = useState(0);
  const limit = 25;

  const updatePage = (nextPage: number) => {
    setPage(nextPage);
    const url = new URL(window.location.href);
    if (nextPage === 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(nextPage));
    window.history.replaceState(null, "", url);
  };

  const fetchActivities = useCallback(async () => {
    setIsLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
      if (sportFilter) params.set("sport", sportFilter);
      if (nameFilter) params.set("name", nameFilter);
      if (filters.period && filters.periodValue) {
        params.set("period", filters.period);
        params.set("period_value", filters.periodValue);
      }
      if (filters.weekday) params.set("weekday", filters.weekday);
      if (filters.minDurationMinutes) params.set("min_duration_s", String(Number(filters.minDurationMinutes) * 60));
      if (filters.maxDurationMinutes) params.set("max_duration_s", String(Number(filters.maxDurationMinutes) * 60));
      if (filters.minTrainingLoad) params.set("min_training_load", filters.minTrainingLoad);
      if (filters.maxTrainingLoad) params.set("max_training_load", filters.maxTrainingLoad);
      if (filters.minDistanceKm) params.set("min_distance_m", String(Number(filters.minDistanceKm) * 1000));
      if (filters.maxDistanceKm) params.set("max_distance_m", String(Number(filters.maxDistanceKm) * 1000));
      params.set("sort", filters.sort);
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
  }, [sportFilter, nameFilter, filters, page, limit]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const totalDistanceMeters = activities.reduce((sum, act) => sum + (act.distance_m || 0), 0);
  const totalDurationSeconds = activities.reduce((sum, act) => sum + (act.elapsed_time_s || 0), 0);
  const totalTrainingLoad = activities.reduce((sum, act) => sum + (act.training_load_vendor || 0), 0);
  const totalCalories = activities.reduce((sum, act) => sum + (act.calories_kcal || 0), 0);
  const avgLoad = activities.length > 0 ? Math.round(totalTrainingLoad / activities.length) : 0;
  const activeFilterCount = [
    Boolean(filters.period && filters.periodValue),
    Boolean(filters.weekday),
    Boolean(filters.minDurationMinutes || filters.maxDurationMinutes),
    Boolean(filters.minTrainingLoad || filters.maxTrainingLoad),
    Boolean(filters.minDistanceKm || filters.maxDistanceKm),
    Boolean(nameFilter),
    filters.sort !== "newest",
  ].filter(Boolean).length;
  const periodInputLabel = draftFilters.period
    ? PERIOD_INPUT_LABELS[draftFilters.period]
    : "Choose a period first";

  const setDraftFilter = (key: keyof ActivityFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <PageTitle>Activities Log</PageTitle>
          <div className="activity-header-controls">
            <details className="activity-filter" name="activity-header-menu">
              <summary className="activity-filter-trigger">
                Filters
                {activeFilterCount > 0 && <span className="activity-filter-count">{activeFilterCount}</span>}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <form
                className="activity-filter-menu"
                onSubmit={(event) => {
                  event.preventDefault();
                  setFilters({ ...draftFilters });
                  setNameFilter(nameDraft.trim());
                  updatePage(1);
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <div className="activity-filter-sport-select">
                  <span>Sport</span>
                  <SingleSelect
                    ariaLabel="Sport filter"
                    value={sportFilter}
                    onChange={(value) => setSportFilter(value)}
                    id="sport-filter"
                    options={[{ value: "", label: "All Sports" }, ...Object.entries(SPORT_LABELS).map(([value, label]) => ({ value, label }))]}
                  />
                </div>
                <div className="activity-name-filter">
                  <span>Activity name</span>
                  <div className="activity-name-search">
                    <input aria-label="Search activities by name" placeholder="Search by activity name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} />
                    <button type="submit" aria-label="Search activities" title="Search activities"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button>
                  </div>
                </div>
                <div className="activity-filter-grid">
                  <div className="activity-filter-field">
                    <span>Filter period</span>
                    <SingleSelect
                      ariaLabel="Filter period"
                      value={draftFilters.period}
                      onChange={(value) => {
                        setDraftFilter("period", value as DatePeriod);
                        setDraftFilter("periodValue", "");
                      }}
                      options={[
                        { value: "", label: "All dates" },
                        { value: "day", label: "Date" },
                        { value: "week", label: "Week" },
                        { value: "month", label: "Month" },
                        { value: "year", label: "Year" },
                      ]}
                    />
                  </div>

                  <div className="activity-filter-field">
                    <span>{periodInputLabel}</span>
                    <CustomDatePicker
                      id="activity-period-value"
                      disabled={!draftFilters.period}
                      mode={draftFilters.period === "day" ? "date" : draftFilters.period || "date"}
                      placeholder={
                        !draftFilters.period
                          ? "Select period first"
                          : draftFilters.period === "day"
                          ? "Select date"
                          : draftFilters.period === "week"
                          ? "Select week"
                          : draftFilters.period === "month"
                          ? "Select month"
                          : "Select year"
                      }
                      value={draftFilters.periodValue}
                      onChange={(val) => setDraftFilter("periodValue", val)}
                    />
                  </div>

                  <div className="activity-filter-field">
                    <span>Day of week</span>
                    <SingleSelect
                      ariaLabel="Day of week"
                      value={draftFilters.weekday}
                      onChange={(value) => setDraftFilter("weekday", value)}
                      options={[
                        { value: "", label: "Any day" },
                        ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => ({
                          value: String(index + 1),
                          label: day,
                        })),
                      ]}
                    />
                  </div>

                  <div className="activity-filter-field">
                    <span>Sort by</span>
                    <SingleSelect
                      ariaLabel="Sort by"
                      value={draftFilters.sort}
                      onChange={(value) => setDraftFilter("sort", value as ActivitySort)}
                      options={[
                        { value: "newest", label: "Newest first" },
                        { value: "oldest", label: "Oldest first" },
                        { value: "duration_desc", label: "Longest duration" },
                        { value: "duration_asc", label: "Shortest duration" },
                        { value: "load_desc", label: "Highest training load" },
                        { value: "load_asc", label: "Lowest training load" },
                        { value: "distance_desc", label: "Longest distance" },
                        { value: "distance_asc", label: "Shortest distance" },
                      ]}
                    />
                  </div>

                  {[
                    ["Duration (min)", "minDurationMinutes", "maxDurationMinutes"],
                    ["Training load", "minTrainingLoad", "maxTrainingLoad"],
                    ["Distance (km)", "minDistanceKm", "maxDistanceKm"],
                  ].map(([label, minimum, maximum]) => (
                    <fieldset className="activity-filter-field activity-filter-range-field" key={label}>
                      <legend>{label}</legend>
                      <div className="activity-filter-range">
                        <NumberStepper
                          ariaLabel={`Minimum ${label}`}
                          placeholder="Min"
                          step="any"
                          value={draftFilters[minimum as keyof ActivityFilters]}
                          onChange={(value) => setDraftFilter(minimum as keyof ActivityFilters, value)}
                        />
                        <span>to</span>
                        <NumberStepper
                          ariaLabel={`Maximum ${label}`}
                          placeholder="Max"
                          step="any"
                          value={draftFilters[maximum as keyof ActivityFilters]}
                          onChange={(value) => setDraftFilter(maximum as keyof ActivityFilters, value)}
                        />
                      </div>
                    </fieldset>
                  ))}
                </div>
                <div className="activity-filter-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(event) => {
                      setDraftFilters(DEFAULT_FILTERS);
                      setFilters(DEFAULT_FILTERS);
                      setNameDraft("");
                      setNameFilter("");
                      updatePage(1);
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    Clear
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm">Apply filters</button>
                </div>
              </form>
            </details>
          </div>
        </header>

        <div className="page-body">
          {/* Overall Activity Insights Grid */}
          <div className="metrics-grid activity-summary-grid" style={{ marginBottom: "var(--space-6)" }}>
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
                    const sportVisual = getSportVisual(activity.sport, activity.title, activity.subsport);
                    const metrics = [
                      ["Distance", activity.distance_m != null ? formatDistance(activity.distance_m) : "--"],
                      ["Duration", activity.training_time_s != null ? formatDuration(activity.training_time_s) : activity.elapsed_time_s != null ? formatDuration(activity.elapsed_time_s) : "--"],
                      ["Avg HR", activity.avg_hr_bpm != null ? `${activity.avg_hr_bpm} bpm` : "--"],
                      ["Pace", activity.training_speed_mps != null ? formatPace(activity.training_speed_mps, activity.sport) : activity.avg_speed_mps != null ? formatPace(activity.avg_speed_mps, activity.sport) : "--"],
                      ["Power", activity.avg_power_w != null ? `${activity.avg_power_w} W` : "--"],
                      ["Calories", activity.calories_kcal != null ? `${activity.calories_kcal} kcal` : "--"],
                      ["Load", activity.training_load_vendor != null ? String(activity.training_load_vendor) : "--"],
                    ];

                    return (
                      <Link
                        key={activity.id}
                        href={`/activities/${activity.id}?sport=${encodeURIComponent(activity.sport)}`}
                        className="activity-card-item activities-log-card"
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
                          <span style={{ display: "flex", transform: "scale(0.8)" }}><SportIcon sport={activity.sport} title={activity.title} subsport={activity.subsport} /></span>
                        </div>
                        <div className="activity-card-content dashboard-activity-content" style={{ minWidth: 0 }}>
                          <div className="activity-card-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px", fontWeight: 750 }}>
                            {activity.title || sportVisual.label}
                          </div>
                          <div className="activity-card-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(64px, max-content))", gap: "4px 16px", marginTop: "5px", fontVariantNumeric: "tabular-nums" }}>
                            {metrics.map(([label, value]) => (
                              <span key={label} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                <span style={{ color: "var(--color-text-muted)", fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
                                <span style={{ color: "var(--color-text-secondary)", fontSize: "10px", whiteSpace: "nowrap" }}>{value}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="activity-card-date dashboard-activity-date" style={{ textAlign: "right", color: "var(--color-text-secondary)", fontSize: "11px", fontVariantNumeric: "tabular-nums" }}>
                          <strong style={{ display: "block", color: "var(--color-text-primary)", fontSize: "12px" }}>
                            {startedAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
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
                        onClick={() => updatePage(page - 1)}
                      >
                        Previous
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={page >= Math.ceil(totalCount / limit)}
                        onClick={() => updatePage(page + 1)}
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
