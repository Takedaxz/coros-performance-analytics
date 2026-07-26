"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Sidebar from "@/components/Sidebar";
import StrengthBodyMap from "@/components/StrengthBodyMap";
import { getSportVisual, SportIcon } from "@/components/SportActivityIcon";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

function AiGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function LoadingGlyph() {
  return (
    <svg className="ai-loading-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

interface ActivityDetail {
  id: string;
  sport: string;
  title?: string;
  start_time: string;
  elapsed_time_s?: number;
  distance_m?: number;
  elevation_gain_m?: number;
  elevation_loss_m?: number;
  avg_hr_bpm?: number;
  max_hr_bpm?: number;
  avg_speed_mps?: number;
  max_speed_mps?: number;
  avg_power_w?: number;
  max_power_w?: number;
  avg_cadence?: number;
  calories_kcal?: number;
  training_load_vendor?: number;
  efficiency_factor_app?: number;
  cardiac_drift_pct_app?: number;
  strength_detail?: StrengthDetail;
  postmortem?: string;
  laps: ActivityLap[];
  lap_splits?: Record<string, ActivityLap[]>;
}

interface ActivityLap {
  lap_index: number;
  start_time?: string;
  leg?: "swim" | "ride" | "run";
  elapsed_s: number;
  distance_m?: number;
  avg_hr_bpm?: number;
  max_hr_bpm?: number;
  avg_speed_mps?: number;
  avg_power_w?: number;
  avg_cadence?: number;
  lap_type?: "recovery" | "rest" | "run" | "functional";
}

interface StrengthDetail {
  sets: number;
  total_reps: number;
  total_weight_kg: number;
  exercises: number;
  calories: number;
  duration_s: number;
  avg_hr_bpm?: number;
  max_hr_bpm?: number;
  training_load?: number;
  aerobic_effect?: number;
  anaerobic_effect?: number;
  exercises_detail: Array<{
    name_key: string;
    name?: string | null;
    sets: number;
    total_reps: number;
    entries: Array<{ reps: number; weight_kg: number; work_s: number; rest_s: number; calories: number }>;
  }>;
}

type ActivityMetric = [label: string, value: string | number, unit?: string];

const STRENGTH_BODY_REGION_NAMES: Record<string, string> = {
  S4208: "Full Body",
  S4209: "Shoulders",
  S4210: "Arms",
  S4211: "Chest",
  S4212: "Back",
  S4213: "Abs",
  S4214: "Legs & Hips",
};

function strengthExerciseName(nameKey: string, name: string | null | undefined): string {
  const rawName = name?.trim();
  if (rawName && !/^[TS]\d/.test(rawName)) return rawName;
  return STRENGTH_BODY_REGION_NAMES[nameKey] ?? nameKey;
}

interface RecordPoint {
  timestamp: string;
  elapsed_s?: number;
  heart_rate_bpm?: number;
  speed_mps?: number;
  altitude_m?: number;
  power_w?: number;
  cadence?: number;
  position_lat?: number;
  position_long?: number;
}

function formatPace(speedMps: number): string {
  if (speedMps <= 0) return "--";
  const paceSecsPerKm = 1000 / speedMps;
  const min = Math.floor(paceSecsPerKm / 60);
  const sec = Math.round(paceSecsPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatSwimPace(speedMps: number): string {
  if (speedMps <= 0) return "--";
  const paceSecondsPer100m = 100 / speedMps;
  const min = Math.floor(paceSecondsPer100m / 60);
  const sec = Math.round(paceSecondsPer100m % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.round(seconds % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatSplitDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatLegDuration(seconds: number): string {
  return seconds >= 3600 ? formatDuration(seconds) : formatSplitDuration(seconds);
}

export default function ActivityDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const activityId = params.id as string;
  const sportHint = searchParams.get("sport") || "";
  const isStrengthSkeleton = sportHint === "strength";
  const isTriathlonSkeleton = sportHint === "multisport";

  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [records, setRecords] = useState<RecordPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [postmortem, setPostmortem] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedLapIndex, setExpandedLapIndex] = useState<number | null>(null);
  const [expandedTriathlonLeg, setExpandedTriathlonLeg] = useState<string | null>(null);
  const sampledRoutePoints = useMemo(() => {
    const routePoints = records
      .filter((record) => record.position_lat != null && record.position_long != null)
      .map((record) => ({
        lat: record.position_lat!,
        lng: record.position_long!,
        elapsed_s: record.elapsed_s,
      }));
    const routeSampleRate = Math.max(1, Math.floor(routePoints.length / 600));
    return routePoints.filter(
      (_, index) => index % routeSampleRate === 0 || index === routePoints.length - 1,
    );
  }, [records]);

  useEffect(() => {
    async function fetchDetail() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const detailRes = await fetch(`${apiBase}/api/activities/${activityId}`);

        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setActivity(detailData);
          setPostmortem(detailData.postmortem || null);
          setExpandedLapIndex(null);
          setExpandedTriathlonLeg(null);
        }
        const recordsRes = await fetch(`${apiBase}/api/activities/${activityId}/records`);
        if (recordsRes.ok) {
          const data = await recordsRes.json();
          setRecords(data.records || []);
        }
      } catch {
        // Backend offline fallback
      }
      setIsLoading(false);
    }

    if (activityId) fetchDetail();
  }, [activityId]);

  async function generatePostmortem() {
    setIsGenerating(true);
    setPostmortem("");
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/ai/postmortem/${activityId}/stream`);

      if (!res.ok || !res.body) {
        setPostmortem("Error generating postmortem analysis.");
        setIsGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const payload = JSON.parse(trimmed.slice(6));
              if (payload.text) {
                setPostmortem((prev) => prev + payload.text);
              }
            } catch {
              // Ignore SSE parse errors
            }
          }
        }
      }

      if (buffer.trim().startsWith("data: ")) {
        try {
          const payload = JSON.parse(buffer.trim().slice(6));
          if (payload.text) {
            setPostmortem((prev) => prev + payload.text);
          }
        } catch {
          // Ignore SSE parse errors
        }
      }
    } catch {
      setPostmortem("Failed to generate postmortem.");
    }
    setIsGenerating(false);
  }

  if (isLoading) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <header className="page-header">
            <h2 className="page-title">Activity Detail</h2>
            <Link href="/activities" className="btn btn-secondary btn-sm">Back</Link>
          </header>

          <div className="page-body">
            {/* Activity Header Identity Skeleton */}
            <div className="activity-detail-identity">
              <div className="skeleton" style={{ width: 38, height: 38, borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="skeleton" style={{ width: "160px", height: "20px", borderRadius: "4px" }} />
                <div className="skeleton" style={{ width: "110px", height: "12px", borderRadius: "3px" }} />
              </div>
            </div>

            {/* Metric Strip Pills Skeleton */}
            <div className="activity-metric-strip">
              {(isStrengthSkeleton
                ? [100, 85, 120, 110, 95, 80, 85, 90]
                : [130, 120, 140, 135, 90, 105, 115, 110]
              ).map((width, i) => (
                <div
                  key={i}
                  className="skeleton"
                  style={{ width: `${width}px`, height: "26px", borderRadius: "999px" }}
                />
              ))}
            </div>

            {/* Sport-Specific Layout Skeletons */}
            {isStrengthSkeleton ? (
              <>
                <div className="strength-overview">
                  <div className="card" style={{ minHeight: "340px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div className="skeleton" style={{ width: "140px", height: "14px", borderRadius: "4px" }} />
                    <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "10px" }} />
                  </div>
                  <div className="card" style={{ minHeight: "340px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div className="skeleton" style={{ width: "200px", height: "14px", borderRadius: "4px" }} />
                    <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "10px" }} />
                  </div>
                </div>

                <div className="card" style={{ marginTop: "var(--space-6)", marginBottom: "var(--space-6)" }}>
                  <div className="card-header">
                    <div className="skeleton" style={{ width: "150px", height: "14px", borderRadius: "4px" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <div className="skeleton" style={{ width: "140px", height: "16px", borderRadius: "4px" }} />
                          <div className="skeleton" style={{ width: "100px", height: "14px", borderRadius: "4px" }} />
                        </div>
                        <div className="skeleton" style={{ width: "100%", height: "90px", borderRadius: "8px" }} />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : isTriathlonSkeleton ? (
              <>
                <div className="card telemetry-card-standalone" style={{ minHeight: "340px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="card-header">
                    <div className="skeleton" style={{ width: "220px", height: "14px", borderRadius: "4px" }} />
                  </div>
                  <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "10px" }} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", marginTop: "var(--space-6)", marginBottom: "var(--space-6)" }}>
                  <div className="card" style={{ minHeight: "300px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="card-header">
                      <div className="skeleton" style={{ width: "130px", height: "14px", borderRadius: "4px" }} />
                    </div>
                    <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "var(--radius-md)" }} />
                  </div>
                  <div className="card" style={{ minHeight: "300px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="card-header">
                      <div className="skeleton" style={{ width: "130px", height: "14px", borderRadius: "4px" }} />
                    </div>
                    <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "var(--radius-md)" }} />
                  </div>
                </div>

                <div className="card" style={{ marginBottom: "var(--space-6)" }}>
                  <div className="card-header">
                    <div className="skeleton" style={{ width: "160px", height: "14px", borderRadius: "4px" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="skeleton" style={{ width: "100%", height: "40px", borderRadius: "8px" }} />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="card telemetry-card-standalone" style={{ minHeight: "340px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div className="card-header">
                    <div className="skeleton" style={{ width: "220px", height: "14px", borderRadius: "4px" }} />
                  </div>
                  <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "10px" }} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", marginTop: "var(--space-6)", marginBottom: "var(--space-6)" }}>
                  <div className="card" style={{ minHeight: "300px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="card-header">
                      <div className="skeleton" style={{ width: "130px", height: "14px", borderRadius: "4px" }} />
                    </div>
                    <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "var(--radius-md)" }} />
                  </div>
                  <div className="card" style={{ minHeight: "300px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div className="card-header">
                      <div className="skeleton" style={{ width: "130px", height: "14px", borderRadius: "4px" }} />
                    </div>
                    <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "var(--radius-md)" }} />
                  </div>
                </div>

                <div className="card" style={{ marginBottom: "var(--space-6)" }}>
                  <div className="card-header">
                    <div className="skeleton" style={{ width: "130px", height: "14px", borderRadius: "4px" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton" style={{ width: "100%", height: "36px", borderRadius: "8px" }} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <header className="page-header"><h2 className="page-title">Activity Not Found</h2></header>
          <div className="page-body" style={{ textAlign: "center", paddingTop: "var(--space-16)", color: "var(--color-text-muted)" }}>
            <p>Activity details could not be loaded.</p>
            <Link href="/activities" className="btn btn-secondary" style={{ marginTop: "var(--space-4)" }}>Back to Activities</Link>
          </div>
        </main>
      </div>
    );
  }

  const sampleRate = Math.max(1, Math.floor(records.length / 300));
  const chartData = records
    .filter((_, i) => i % sampleRate === 0)
    .map((r) => ({
      time: r.elapsed_s ? Math.round(r.elapsed_s / 60) : 0,
      hr: r.heart_rate_bpm,
      speed: r.speed_mps ? Math.round(r.speed_mps * 3.6 * 10) / 10 : undefined,
      alt: r.altitude_m != null ? Math.round(r.altitude_m) : undefined,
      power: r.power_w,
    }));
  const elevationValues = chartData
    .map((point) => point.alt)
    .filter((altitude): altitude is number => altitude != null);
  const elevationBounds: [number, number] | null = elevationValues.length
    ? [Math.min(...elevationValues), Math.max(...elevationValues)]
    : null;
  const elevationPadding = elevationBounds
    ? elevationBounds[1] === elevationBounds[0]
      ? 5
      : Math.max(1, (elevationBounds[1] - elevationBounds[0]) * 0.2)
    : 0;
  const hasHeartRateData = chartData.some((point) => point.hr != null);
  const hasSpeedData = chartData.some((point) => point.speed != null);
  const hasTelemetryData = hasHeartRateData || hasSpeedData;

  const strength = activity.sport === "strength" ? activity.strength_detail : undefined;
  const isSwim = activity.sport === "swim";
  const isRun = ["run", "trail_run"].includes(activity.sport);
  const triathlonLegs = ["swim", "ride", "run"]
    .map((sport) => ({
      sport,
      laps: activity.laps.filter((lap) => lap.leg === sport),
    }))
    .filter((leg) => leg.laps.length > 0);
  const triathlonLegDetails = triathlonLegs.map((leg, index) => {
    const start = leg.laps[0]?.start_time ? new Date(leg.laps[0].start_time).getTime() : 0;
    const nextStartTime = triathlonLegs[index + 1]?.laps[0]?.start_time;
    const nextStart = nextStartTime
      ? new Date(nextStartTime).getTime()
      : 0;
    const recordBeforeNextLeg = nextStart
      ? [...records].reverse().find((record) => new Date(record.timestamp).getTime() < nextStart)
      : records[records.length - 1];
    const recordAtNextLeg = nextStart
      ? records.find((record) => new Date(record.timestamp).getTime() >= nextStart)
      : undefined;
    const end = recordBeforeNextLeg ? new Date(recordBeforeNextLeg.timestamp).getTime() : 0;
    const timelineDuration = start && end > start ? (end - start) / 1000 : 0;
    const transition = recordBeforeNextLeg && recordAtNextLeg
      ? (new Date(recordAtNextLeg.timestamp).getTime() - end) / 1000
      : 0;
    const lapDuration = leg.laps.reduce((total, lap) => total + lap.elapsed_s, 0);
    const duration = transition > 0 && Math.abs(lapDuration - timelineDuration) >= transition - 2
      ? timelineDuration
      : lapDuration;
    const distance = leg.laps.reduce((total, lap) => total + (lap.distance_m ?? 0), 0);
    const legRecords = records.filter((record) => {
      const timestamp = new Date(record.timestamp).getTime();
      return timestamp >= start && timestamp <= end && record.heart_rate_bpm != null;
    });
    const avgHr = legRecords.length
      ? Math.round(legRecords.reduce((total, record) => total + (record.heart_rate_bpm ?? 0), 0) / legRecords.length)
      : null;
    const powerDuration = leg.laps
      .filter((lap) => lap.avg_power_w != null)
      .reduce((total, lap) => total + lap.elapsed_s, 0);
    const avgPower = powerDuration
      ? Math.round(leg.laps.reduce((total, lap) => total + (lap.avg_power_w ?? 0) * lap.elapsed_s, 0) / powerDuration)
      : null;
    const cadenceDuration = leg.laps
      .filter((lap) => lap.avg_cadence != null)
      .reduce((total, lap) => total + lap.elapsed_s, 0);
    const avgCadence = cadenceDuration
      ? Math.round(leg.laps.reduce((total, lap) => total + (lap.avg_cadence ?? 0) * lap.elapsed_s, 0) / cadenceDuration)
      : null;

    return { ...leg, distance, duration, avgHr, avgPower, avgCadence, transition };
  });
  const isTriathlon = activity.sport === "multisport" && triathlonLegDetails.length > 1;
  const triathlonSpeedMetrics: ActivityMetric[] = isTriathlon
    ? triathlonLegDetails.flatMap((leg) => {
        const speed = leg.distance / leg.duration;
        if (!Number.isFinite(speed) || speed <= 0) return [];
        if (leg.sport === "swim") return [["Swim pace", formatSwimPace(speed), "/100m"] as ActivityMetric];
        if (leg.sport === "run") return [["Run pace", formatPace(speed), "/km"] as ActivityMetric];
        return [["Bike speed", (speed * 3.6).toFixed(1), "km/h"] as ActivityMetric];
      })
    : [];
  const sportVisual = getSportVisual(activity.sport);
  const activityTime = new Date(activity.start_time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const activeSwimLaps = isSwim ? activity.laps.filter((lap) => (lap.distance_m ?? 0) > 0) : [];
  const activeSwimDistance = activeSwimLaps.reduce((total, lap) => total + (lap.distance_m ?? 0), 0);
  const activeSwimDuration = activeSwimLaps.reduce((total, lap) => total + lap.elapsed_s, 0);
  const activeRunLaps = isRun
    ? activity.laps.filter((lap) => (lap.distance_m ?? 0) > 0 && lap.lap_type !== "recovery")
    : [];
  const activeRunDistance = activeRunLaps.reduce((total, lap) => total + (lap.distance_m ?? 0), 0);
  const activeRunDuration = activeRunLaps.reduce((total, lap) => total + lap.elapsed_s, 0);
  const activityMetrics: ActivityMetric[] = strength
    ? [
        ["Sets", strength.sets],
        ["Reps", strength.total_reps],
        ["Total weight", strength.total_weight_kg, "kg"],
        ["Calories", strength.calories, "kcal"],
        ["Duration", formatDuration(strength.duration_s)],
        ["Avg HR", strength.avg_hr_bpm ?? "--", "bpm"],
        ["Max HR", strength.max_hr_bpm ?? "--", "bpm"],
        ["Training load", strength.training_load ?? activity.training_load_vendor ?? "--"],
        ["Aerobic", strength.aerobic_effect?.toFixed(1) ?? "--"],
        ["Anaerobic", strength.anaerobic_effect?.toFixed(1) ?? "--"],
      ]
    : [
        ...(activity.distance_m != null && activity.distance_m > 0
          ? [["Distance", (activity.distance_m / 1000).toFixed(2), "km"] as ActivityMetric]
          : []),
        ...(activity.elapsed_time_s != null && activity.elapsed_time_s > 0
          ? [["Duration", formatDuration(activity.elapsed_time_s)] as ActivityMetric]
          : []),
        ...(activity.avg_speed_mps != null && activity.avg_speed_mps > 0 && !isTriathlon
          ? activity.sport === "swim"
            ? [["Overall pace", formatSwimPace(activity.avg_speed_mps), "/100m"] as ActivityMetric]
            : ["run", "trail_run", "walk", "hike"].includes(activity.sport)
              ? [["Overall pace", formatPace(activity.avg_speed_mps), "/km"] as ActivityMetric]
              : [["Avg speed", (activity.avg_speed_mps * 3.6).toFixed(1), "km/h"] as ActivityMetric]
          : []),
        ...triathlonSpeedMetrics,
        ...(activeSwimDistance > 0 && activeSwimDuration > 0
          ? [["Active pace", formatSwimPace(activeSwimDistance / activeSwimDuration), "/100m"] as ActivityMetric]
          : []),
        ...(activeRunDistance > 0 && activeRunDuration > 0
          ? [["Active pace", formatPace(activeRunDistance / activeRunDuration), "/km"] as ActivityMetric]
          : []),
        ...(activity.avg_hr_bpm != null ? [["Avg HR", activity.avg_hr_bpm, "bpm"] as ActivityMetric] : []),
        ...(activity.max_hr_bpm != null ? [["Max HR", activity.max_hr_bpm, "bpm"] as ActivityMetric] : []),
        ...(activity.avg_power_w != null && activity.avg_power_w > 0
          ? [["Avg power", Math.round(activity.avg_power_w), "W"] as ActivityMetric]
          : []),
        ...(activity.avg_cadence != null && activity.avg_cadence > 0
          ? [["Cadence", Math.round(activity.avg_cadence), "spm"] as ActivityMetric]
          : []),
        ...(activity.elevation_gain_m != null && activity.elevation_gain_m > 0
          ? [["Elevation gain", `+${Math.round(activity.elevation_gain_m)}`, "m"] as ActivityMetric]
          : []),
        ...(activity.calories_kcal != null && activity.calories_kcal > 0
          ? [["Calories", Math.round(activity.calories_kcal), "kcal"] as ActivityMetric]
          : []),
        ...(activity.training_load_vendor != null
          ? [["Training load", activity.training_load_vendor] as ActivityMetric]
          : []),
      ];
  const telemetryCard = hasTelemetryData && (
    <div className={`card${strength ? "" : " telemetry-card-standalone"}`} id="chart-hr-speed" style={{ marginBottom: "var(--space-6)" }}>
      <div className="card-header">
        <span className="card-title">Heart Rate & Speed Telemetry</span>
      </div>
      <div className="telemetry-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
            <XAxis dataKey="time" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit=" min" />
            {hasHeartRateData && <YAxis yAxisId="hr" width={42} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} domain={["dataMin - 10", "dataMax + 10"]} />}
            {hasSpeedData && <YAxis yAxisId="speed" orientation="right" width={48} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit=" km/h" />}
            <Tooltip />
            {hasHeartRateData && <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="var(--color-status-critical)" strokeWidth={2} dot={false} name="Heart Rate (bpm)" />}
            {hasSpeedData && <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="var(--color-accent-primary)" strokeWidth={2} dot={false} name="Speed (km/h)" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <h2 className="page-title">Activity Detail</h2>
          <Link href="/activities" className="btn btn-secondary btn-sm">Back</Link>
        </header>

        <div className="page-body">
          <div className="activity-detail-identity">
            <span className="activity-detail-icon" style={{ background: sportVisual.background, color: sportVisual.color }}>
              <SportIcon sport={activity.sport} />
            </span>
            <div>
              <h1>{activity.title || sportVisual.label}</h1>
              <span>{activityTime}</span>
            </div>
          </div>
          <div className="activity-metric-strip">
            {activityMetrics.map(([label, value, unit]) => (
              <span className="activity-metric-pill" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                {unit && <em>{unit}</em>}
              </span>
            ))}
          </div>
          {strength ? (
            <>
              <div className="strength-overview">
                <StrengthBodyMap exercises={strength.exercises_detail} />
                {telemetryCard}
              </div>
            </>
          ) : (
            telemetryCard
          )}

          {strength && (
            <div className="card" style={{ marginTop: "var(--space-6)", marginBottom: "var(--space-6)" }}>
              <div className="card-header"><span className="card-title">Strength Breakdown</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                {strength.exercises_detail.map((exercise, exerciseIndex) => (
                  <div key={`${exercise.name_key}-${exerciseIndex}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
                      <strong>{exerciseIndex + 1}. {strengthExerciseName(exercise.name_key, exercise.name)}</strong>
                      <span style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}>{exercise.sets} sets · {exercise.total_reps} reps</span>
                    </div>
                    <div className="table-responsive">
                      <table className="data-table">
                        <thead><tr><th>Set</th><th>Reps</th><th>Weight</th><th>Time</th><th>Rest</th><th>Calories</th></tr></thead>
                        <tbody>{exercise.entries.map((entry, setIndex) => (
                          <tr key={setIndex}><td>{setIndex + 1}</td><td>{entry.reps}</td><td>{entry.weight_kg > 0 ? `${entry.weight_kg} kg` : "--"}</td><td>{formatDuration(entry.work_s)}</td><td>{entry.rest_s > 0 ? formatDuration(entry.rest_s) : "--"}</td><td>{entry.calories}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Route Map & Elevation Grid */}
          {(sampledRoutePoints.length > 0 || chartData.some((d) => d.alt != null)) && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-6)", marginBottom: "var(--space-6)" }}>
              {sampledRoutePoints.length > 0 && (
                <div className="card" id="chart-route" style={{ display: "flex", flexDirection: "column" }}>
                  <div className="card-header">
                    <span className="card-title">GPS Route Overlay</span>
                  </div>
                  <div style={{ flex: 1, position: "relative", minHeight: "260px", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                    <Map key={activityId} points={sampledRoutePoints} />
                  </div>
                </div>
              )}

              {elevationBounds && (
                <div className="card" id="chart-elevation" style={{ display: "flex", flexDirection: "column" }}>
                  <div className="card-header">
                    <span className="card-title">Elevation Profile</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                      <XAxis dataKey="time" tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit=" min" />
                      <YAxis domain={[elevationBounds[0] - elevationPadding, elevationBounds[1] + elevationPadding]} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} axisLine={false} unit="m" />
                      <Tooltip />
                      <Line type="monotone" dataKey="alt" stroke="var(--color-status-positive)" strokeWidth={2} dot={false} name="Elevation (m)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Laps Table */}
          {isTriathlon && (
            <div className="card" style={{ marginBottom: "var(--space-6)" }} id="laps-table">
              <div className="card-header">
                <span className="card-title">Triathlon Breakdown</span>
              </div>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr><th>Leg</th><th>Distance</th><th>Duration</th><th>Avg HR</th><th>Pace / Speed</th><th>Power / Cadence</th></tr>
                  </thead>
                  <tbody>
                    {triathlonLegDetails.map((leg, index) => {
                      const speed = leg.distance > 0 && leg.duration > 0 ? leg.distance / leg.duration : 0;
                      const label = leg.sport === "ride" ? "Bike" : leg.sport[0].toUpperCase() + leg.sport.slice(1);
                      const paceOrSpeed = leg.sport === "swim"
                        ? `${formatSwimPace(speed)}/100m`
                        : leg.sport === "run"
                          ? `${formatPace(speed)}/km`
                          : `${(speed * 3.6).toFixed(1)} km/h`;
                      const isExpanded = expandedTriathlonLeg === leg.sport;

                      return (
                        <Fragment key={leg.sport}>
                          <tr>
                            <td className="mono">
                              <button
                                type="button"
                                className="lap-expand-button"
                                aria-expanded={isExpanded}
                                onClick={() => setExpandedTriathlonLeg(isExpanded ? null : leg.sport)}
                              >
                                {label}
                              </button>
                            </td>
                            <td className="mono">{(leg.distance / 1000).toFixed(2)} km</td>
                            <td className="mono">{formatLegDuration(leg.duration)}</td>
                            <td className="mono">{leg.avgHr ? `${leg.avgHr} bpm` : "--"}</td>
                            <td className="mono">{paceOrSpeed}</td>
                            <td className="mono">{leg.sport === "swim" ? leg.avgCadence ? `${leg.avgCadence} spm` : "--" : leg.avgPower ? `${leg.avgPower} W` : "--"}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="lap-split-row">
                              <td colSpan={6}>
                                <div className="lap-split-label">{label} lap breakdown</div>
                                <table className="lap-split-table">
                                  <thead><tr><th>Lap</th><th>Distance</th><th>Duration</th><th>Avg HR</th><th>Pace / Speed</th><th>Power / Cadence</th></tr></thead>
                                  <tbody>{leg.laps.map((lap, lapIndex) => (
                                    <tr key={lap.lap_index}>
                                      <td>{lapIndex + 1}</td>
                                      <td>{lap.distance_m ? leg.sport === "swim" ? `${Math.round(lap.distance_m)} m` : `${(lap.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                                      <td>{formatSplitDuration(lap.elapsed_s)}</td>
                                      <td>{lap.avg_hr_bpm ? `${lap.avg_hr_bpm} bpm` : "--"}</td>
                                      <td>{lap.avg_speed_mps ? leg.sport === "swim" ? formatSwimPace(lap.avg_speed_mps) : leg.sport === "run" ? formatPace(lap.avg_speed_mps) : `${(lap.avg_speed_mps * 3.6).toFixed(1)} km/h` : "--"}</td>
                                      <td>{leg.sport === "swim" ? lap.avg_cadence ? `${lap.avg_cadence} spm` : "--" : lap.avg_power_w ? `${lap.avg_power_w} W` : "--"}</td>
                                    </tr>
                                  ))}</tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                          {leg.transition > 0 && (
                            <tr>
                              <td className="mono">T{index + 1}</td>
                              <td className="mono">--</td>
                              <td className="mono">{formatSplitDuration(leg.transition)}</td>
                              <td className="mono">--</td>
                              <td className="mono" colSpan={2}>Transition</td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activity.sport !== "strength" && !isTriathlon && activity.laps.length > 0 && (
            <div className="card" style={{ marginBottom: "var(--space-6)" }} id="laps-table">
              <div className="card-header">
                <span className="card-title">Split Breakdown</span>
              </div>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lap</th>
                      <th>Distance</th>
                      <th>Duration</th>
                      <th>Avg HR</th>
                      <th>{isTriathlon ? "Pace / Speed" : isSwim ? "Pace /100m" : "Pace"}</th>
                      <th>{isTriathlon ? "Power / Cadence" : isSwim ? "Stroke rate" : "Power"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.laps.map((lap) => {
                      const kilometerSplits = activity.lap_splits?.[String(lap.lap_index)] ?? [];
                      const isExpanded = expandedLapIndex === lap.lap_index;
                      const lapSport = lap.leg ?? activity.sport;
                      const isLapSwim = lapSport === "swim";
                      const isLapPaceSport = ["run", "trail_run", "walk", "hike"].includes(lapSport);
                      const lapNumber = lap.lap_index === 0 ? 1 : lap.lap_index;
                      const legLapNumber = isTriathlon && lap.leg
                        ? activity.laps.filter((candidate) => candidate.leg === lap.leg).indexOf(lap) + 1
                        : lapNumber;
                      const isRest = isLapSwim
                        ? !lap.distance_m || lap.distance_m <= 0
                        : lap.lap_type === "rest" || lap.lap_type === "recovery";
                      const canExpand = kilometerSplits.length > 1;
                      const toggleLap = (): void => setExpandedLapIndex(isExpanded ? null : lap.lap_index);

                      return (
                        <Fragment key={lap.lap_index}>
                          <tr
                            className={`lap-summary-row${isExpanded ? " is-expanded" : ""}${canExpand ? " is-clickable" : ""}`}
                            onClick={canExpand ? toggleLap : undefined}
                          >
                            <td className="mono">
                              {canExpand ? (
                                <button
                                  type="button"
                                  className="lap-expand-button lap-expand-button-plain"
                                  aria-expanded={isExpanded}
                                  aria-label={`Toggle kilometre breakdown for lap ${lapNumber}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleLap();
                                  }}
                                >
                                  <span>{lapNumber}</span>
                                  <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="m4 6 4 4 4-4" />
                                  </svg>
                                </button>
                              ) : isRest ? "Rest" : lap.lap_type === "run" ? "Run" : lap.lap_type === "functional" ? "Functional" : isTriathlon && lap.leg ? `${lap.leg === "ride" ? "Bike" : lap.leg[0].toUpperCase() + lap.leg.slice(1)} ${legLapNumber}` : lapNumber}
                            </td>
                            <td className="mono">{lap.distance_m ? isLapSwim ? `${Math.round(lap.distance_m)} m` : `${(lap.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                            <td className="mono">{Math.floor(lap.elapsed_s / 60)}:{String(Math.round(lap.elapsed_s % 60)).padStart(2, "0")}</td>
                            <td className="mono">{lap.avg_hr_bpm ? `${lap.avg_hr_bpm} bpm` : "--"}</td>
                            <td className="mono">{lap.avg_speed_mps ? isLapSwim ? formatSwimPace(lap.avg_speed_mps) : isLapPaceSport ? formatPace(lap.avg_speed_mps) : `${(lap.avg_speed_mps * 3.6).toFixed(1)} km/h` : "--"}</td>
                            <td className="mono">{isLapSwim ? lap.avg_cadence ? `${lap.avg_cadence} spm` : "--" : lap.avg_power_w ? `${lap.avg_power_w} W` : "--"}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="lap-split-row">
                              <td colSpan={6}>
                                <div className="lap-split-header">
                                  <div>
                                    <div className="lap-split-label">{isSwim ? "Length breakdown" : "Kilometre breakdown"}</div>
                                    <div className="lap-split-description">{isSwim ? "Pace and heart rate by pool length" : "Pace and heart rate by kilometre"}</div>
                                  </div>
                                  <span className="lap-split-count">{kilometerSplits.length} splits</span>
                                </div>
                                <table className="lap-split-table mono">
                                  <thead><tr><th>{isSwim ? "Length" : "Km"}</th><th>Distance</th><th>Duration</th><th>{isSwim ? "Pace /100m" : "Pace"}</th><th>Avg HR</th><th>Max HR</th></tr></thead>
                                  <tbody>{kilometerSplits.map((split, index) => (
                                    <tr key={`${lap.lap_index}-${index}`}>
                                      <td><span className="lap-split-index">{index + 1}</span></td>
                                      <td>{split.distance_m ? isSwim ? `${Math.round(split.distance_m)} m` : `${(split.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                                      <td>{formatSplitDuration(split.elapsed_s)}</td>
                                      <td className="lap-split-pace">{split.avg_speed_mps ? isSwim ? formatSwimPace(split.avg_speed_mps) : `${formatPace(split.avg_speed_mps)}/km` : "--"}</td>
                                      <td>{split.avg_hr_bpm ? `${split.avg_hr_bpm} bpm` : "--"}</td>
                                      <td>{split.max_hr_bpm ? `${split.max_hr_bpm} bpm` : "--"}</td>
                                    </tr>
                                  ))}</tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AI Performance Coach Analysis */}
          <div className="card no-hover ai-analysis-card" id="ai-analysis-card">
            <div className="ai-analysis-header">
              <div className="ai-analysis-heading">
                <span className="ai-analysis-icon">
                  <AiGlyph />
                </span>
                <div>
                  <span className="card-title">AI Performance Coach Analysis</span>
                {!postmortem && (
                  <span className="ai-analysis-meta">
                    Workout execution, pacing, load & recovery
                  </span>
                )}
                </div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={generatePostmortem} disabled={isGenerating}>
                {isGenerating ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <LoadingGlyph />
                    Analyzing
                  </span>
                ) : (
                  postmortem ? "Run again" : "Run AI Analysis"
                )}
              </button>
            </div>
            {isGenerating && !postmortem && (
              <div className="msg-row ai-row ai-analysis-thinking">
                <div className="avatar-sq ai" aria-label="AI Coach is analyzing"><AiGlyph /></div>
                <div className="ai-text">
                  <span className="ai-thinking-status" style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--color-text-muted)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", paddingTop: "2px" }}>
                    evaluating splits & physiological recovery
                    <span className="chat-loading-dots" aria-label="Loading">
                      <span className="chat-loading-dot" /><span className="chat-loading-dot" /><span className="chat-loading-dot" />
                    </span>
                  </span>
                </div>
              </div>
            )}
            {postmortem && (
              <div className="ai-analysis-response">
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{postmortem}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
