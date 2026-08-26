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
  ReferenceLine,
} from "recharts";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import StrengthBodyMap from "@/components/StrengthBodyMap";
import { getSportVisual, SportIcon } from "@/components/SportActivityIcon";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { WaveThinkingText } from "@/components/WaveThinkingText";

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
  subsport?: string;
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
  activity_note?: string;
  threshold_hr_bpm?: number;
  threshold_pace_s_per_km?: number;
  laps: ActivityLap[];
  lap_splits?: Record<string, ActivityLap[]>;
}

interface ActivityLap {
  lap_index: number;
  start_time?: string;
  start_elapsed_s?: number;
  leg?: "swim" | "ride" | "run";
  lap_name?: string;
  load_unit?: "m" | "reps";
  elapsed_s: number;
  distance_m?: number;
  avg_hr_bpm?: number;
  max_hr_bpm?: number;
  avg_speed_mps?: number;
  avg_power_w?: number;
  avg_cadence?: number;
  lap_type?: "warmup" | "training" | "cooldown" | "rest" | "run" | "ride" | "swim" | "functional";
  hrr_bpm?: number;
}

const LAP_TYPE_LABELS: Record<NonNullable<ActivityLap["lap_type"]>, string> = {
  warmup: "Warm-up",
  training: "Training",
  cooldown: "Cool-down",
  rest: "Rest",
  run: "Run",
  ride: "Ride",
  swim: "Swim",
  functional: "Functional",
};

interface ActivityLapGroup {
  laps: ActivityLap[];
  summary: ActivityLap;
}

type WeightedLapMetric = "avg_hr_bpm" | "avg_power_w" | "avg_cadence";

function weightedLapAverage(
  laps: ActivityLap[],
  metric: WeightedLapMetric,
): number | undefined {
  const measured = laps.filter((lap) => lap[metric] != null && lap.elapsed_s > 0);
  const duration = measured.reduce((total, lap) => total + lap.elapsed_s, 0);
  if (duration <= 0) return undefined;
  return Math.round(
    measured.reduce((total, lap) => total + (lap[metric] ?? 0) * lap.elapsed_s, 0) /
    duration,
  );
}

function summarizeLapGroup(laps: ActivityLap[]): ActivityLap {
  const first = laps[0];
  const elapsed = laps.reduce((total, lap) => total + lap.elapsed_s, 0);
  const distances = laps.flatMap((lap) => lap.distance_m != null ? [lap.distance_m] : []);
  const distance = distances.length
    ? distances.reduce((total, value) => total + value, 0)
    : undefined;
  const maxHeartRates = laps.flatMap((lap) =>
    lap.max_hr_bpm != null ? [lap.max_hr_bpm] : [],
  );

  return {
    ...first,
    elapsed_s: elapsed,
    distance_m: distance,
    avg_hr_bpm: weightedLapAverage(laps, "avg_hr_bpm"),
    max_hr_bpm: maxHeartRates.length ? Math.max(...maxHeartRates) : undefined,
    avg_speed_mps: distance != null && elapsed > 0 ? distance / elapsed : undefined,
    avg_power_w: weightedLapAverage(laps, "avg_power_w"),
    avg_cadence: weightedLapAverage(laps, "avg_cadence"),
  };
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

import { resolveExerciseName } from "@/lib/exerciseNames";

function strengthExerciseName(nameKey: string, name: string | null | undefined): string {
  return resolveExerciseName(nameKey, name);
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
  ground_time_ms?: number;
  stride_length_cm?: number;
  stride_ratio_pct?: number;
  stride_height_cm?: number;
}

type RunningDynamicsKey =
  | "cadence"
  | "stride_length_cm"
  | "power_w"
  | "ground_time_ms"
  | "stride_ratio_pct"
  | "stride_height_cm";

interface RunningDynamicsMetric {
  key: RunningDynamicsKey;
  label: string;
  unit: string;
  decimals: number;
  color: string;
  ignoreZero: boolean;
}

const RUNNING_DYNAMICS_METRICS: RunningDynamicsMetric[] = [
  { key: "cadence", label: "Cadence", unit: "spm", decimals: 0, color: "#ff4f87", ignoreZero: false },
  { key: "stride_length_cm", label: "Stride length", unit: "cm", decimals: 0, color: "#9d7bff", ignoreZero: true },
  { key: "power_w", label: "Running power", unit: "W", decimals: 0, color: "#ff8a2a", ignoreZero: false },
  { key: "ground_time_ms", label: "Ground time", unit: "ms", decimals: 0, color: "#00cfe8", ignoreZero: true },
  { key: "stride_ratio_pct", label: "Stride ratio", unit: "%", decimals: 1, color: "#f6d43a", ignoreZero: true },
  { key: "stride_height_cm", label: "Stride height", unit: "cm", decimals: 1, color: "#35d07f", ignoreZero: true },
];

interface TrainingZone {
  key: string;
  label: string;
  range: string;
  color: string;
  min: number;
  max: number;
}

interface ZoneSummary extends TrainingZone {
  seconds: number;
  percent: number;
}

interface SegmentDetailProps {
  lap: ActivityLap;
  records: RecordPoint[];
  sport: string;
}

interface BreakdownHeaderProps {
  title: string;
  description: string;
  count: number;
  itemLabel: string;
}

interface PhaseRowProps {
  badge?: string;
  title: string;
  description: string;
  duration: string;
  avgHr?: number;
  heartRateRecovery?: string | null;
}

function BreakdownHeader({ title, description, count, itemLabel }: BreakdownHeaderProps) {
  return (
    <div className="breakdown-header">
      <div>
        <span className="breakdown-kicker">Performance detail</span>
        <h2 className="card-title">{title}</h2>
        <p>{description}</p>
      </div>
      <span className="breakdown-count">
        {count} {itemLabel}{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function PhaseRow({ badge, title, description, duration, avgHr, heartRateRecovery }: PhaseRowProps) {
  return (
    <tr className="breakdown-phase-row">
      <td colSpan={6}>
        <div className="breakdown-phase">
          <div className="breakdown-phase-identity">
            {badge && <span className="breakdown-phase-badge">{badge}</span>}
            <span className="breakdown-phase-copy">
              <strong>{title}</strong>
              <span>{description}</span>
            </span>
          </div>
          <div className="breakdown-phase-metrics">
            {avgHr != null && (
              <span className="breakdown-phase-stat">
                <span>Avg HR</span>
                <strong>{avgHr} bpm</strong>
              </span>
            )}
            {heartRateRecovery && (
              <span className="breakdown-phase-stat">
                <span>HR recovery</span>
                <strong>{heartRateRecovery}</strong>
              </span>
            )}
            <span className="breakdown-phase-stat">
              <span>Duration</span>
              <strong>{duration}</strong>
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
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

function formatHeartRateRecovery(lap: ActivityLap): string | null {
  return lap.hrr_bpm != null ? `${lap.hrr_bpm} bpm` : null;
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

function formatSwimLapDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

function formatPaceSeconds(seconds: number): string {
  return formatPace(1000 / seconds);
}

function formatDynamicsValue(value: number, metric: RunningDynamicsMetric): string {
  return value.toFixed(metric.decimals);
}

const ZONE_COLORS = ["#3488df", "#36bed2", "#3bc76b", "#f0ca3e", "#ff7548", "#ef3944"];

function buildHeartRateZones(thresholdHr: number): TrainingZone[] {
  const [recovery, aerobicEndurance, aerobicPower, threshold, anaerobicEndurance] = [
    0.8,
    0.9,
    0.95,
    1.02,
    1.06,
  ].map((factor) => Math.round(thresholdHr * factor));
  return [
    { key: "recovery", label: "Recovery", range: `<${recovery}`, color: ZONE_COLORS[0], min: 0, max: recovery },
    { key: "aerobic-endurance", label: "Aerobic Endurance", range: `${recovery}–${aerobicEndurance}`, color: ZONE_COLORS[1], min: recovery, max: aerobicEndurance + 1 },
    { key: "aerobic-power", label: "Aerobic Power", range: `${aerobicEndurance + 1}–${aerobicPower}`, color: ZONE_COLORS[2], min: aerobicEndurance + 1, max: aerobicPower + 1 },
    { key: "threshold", label: "Threshold", range: `${aerobicPower + 1}–${threshold}`, color: ZONE_COLORS[3], min: aerobicPower + 1, max: threshold + 1 },
    { key: "anaerobic-endurance", label: "Anaerobic Endurance", range: `${threshold + 1}–${anaerobicEndurance}`, color: ZONE_COLORS[4], min: threshold + 1, max: anaerobicEndurance + 1 },
    { key: "anaerobic-power", label: "Anaerobic Power", range: `>${anaerobicEndurance}`, color: ZONE_COLORS[5], min: anaerobicEndurance + 1, max: Number.POSITIVE_INFINITY },
  ];
}

function buildPaceZones(thresholdPace: number): TrainingZone[] {
  const anaerobicPower = Math.ceil(thresholdPace * 0.875);
  const anaerobicEndurance = Math.round(thresholdPace * 0.98);
  const threshold = Math.round(thresholdPace * 1.085);
  const aerobicPower = Math.round(thresholdPace * 1.23);
  const recovery = Math.round(thresholdPace * 1.425);
  return [
    { key: "recovery", label: "Recovery", range: `>${formatPaceSeconds(recovery - 1)}`, color: ZONE_COLORS[0], min: recovery, max: Number.POSITIVE_INFINITY },
    { key: "aerobic-endurance", label: "Aerobic Endurance", range: `${formatPaceSeconds(aerobicPower)}–${formatPaceSeconds(recovery - 1)}`, color: ZONE_COLORS[1], min: aerobicPower, max: recovery },
    { key: "aerobic-power", label: "Aerobic Power", range: `${formatPaceSeconds(threshold)}–${formatPaceSeconds(aerobicPower - 1)}`, color: ZONE_COLORS[2], min: threshold, max: aerobicPower },
    { key: "threshold", label: "Threshold", range: `${formatPaceSeconds(anaerobicEndurance)}–${formatPaceSeconds(threshold - 1)}`, color: ZONE_COLORS[3], min: anaerobicEndurance, max: threshold },
    { key: "anaerobic-endurance", label: "Anaerobic Endurance", range: `${formatPaceSeconds(anaerobicPower)}–${formatPaceSeconds(anaerobicEndurance - 1)}`, color: ZONE_COLORS[4], min: anaerobicPower, max: anaerobicEndurance },
    { key: "anaerobic-power", label: "Anaerobic Power", range: `<${formatPaceSeconds(anaerobicPower)}`, color: ZONE_COLORS[5], min: 0, max: anaerobicPower },
  ];
}

function findTrainingZone(zones: TrainingZone[], value: number): TrainingZone | undefined {
  return zones.find((zone) => value >= zone.min && value < zone.max);
}

function summarizeTrainingZones(values: number[], zones: TrainingZone[]): ZoneSummary[] {
  if (!zones.length) return [];
  const total = values.length;
  const secondsByZone = zones.map(
    (zone) => values.filter((value) => value >= zone.min && value < zone.max).length,
  );
  if (!total) {
    return zones.map((zone) => ({ ...zone, seconds: 0, percent: 0 }));
  }
  const rawPercentages = secondsByZone.map((seconds) => (seconds / total) * 100);
  const percentages = rawPercentages.map(Math.floor);
  const remainderOrder = rawPercentages
    .map((percent, index) => ({ index, fraction: percent - percentages[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  const remainder = 100 - percentages.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remainder; index += 1) {
    percentages[remainderOrder[index].index] += 1;
  }
  return zones.map((zone, index) => ({
    ...zone,
    seconds: secondsByZone[index],
    percent: percentages[index],
  }));
}

function ZoneDistribution({ zones }: { zones: ZoneSummary[] }) {
  return (
    <div className="training-zone-list">
      {zones.map((zone) => (
        <div className="training-zone-row" key={zone.key}>
          <span className="training-zone-name">{zone.label}</span>
          <span className="training-zone-range mono">{zone.range}</span>
          <span className="training-zone-track" aria-hidden="true">
            <span style={{ width: `${zone.percent}%`, background: zone.color }} />
          </span>
          <strong className="mono">{zone.percent}%</strong>
          <span className="training-zone-time mono">{formatSplitDuration(zone.seconds)}</span>
        </div>
      ))}
    </div>
  );
}

function formatLegDuration(seconds: number): string {
  return seconds >= 3600 ? formatDuration(seconds) : formatSplitDuration(seconds);
}

type SegmentSignal = "pace" | "swim_pace" | "stroke" | "power" | "speed" | "cadence";

function SegmentDetail({ lap, records, sport }: SegmentDetailProps) {
  const startElapsed = lap.start_elapsed_s ?? 0;
  const endElapsed = startElapsed + lap.elapsed_s;
  const segmentRecords = records.filter(
    (record) =>
      record.elapsed_s != null &&
      record.elapsed_s >= startElapsed &&
      record.elapsed_s < endElapsed,
  );
  const sampleRate = Math.max(1, Math.ceil(segmentRecords.length / 240));
  const isPaceSport =
    lap.lap_type === "run" || ["run", "trail_run", "walk", "hike"].includes(sport);
  const isSwim = sport === "swim";
  const isRide = sport === "ride";
  const hasSpeed = segmentRecords.some((record) => (record.speed_mps ?? 0) > 0);
  const hasPower = segmentRecords.some((record) => (record.power_w ?? 0) > 0);
  const hasCadence = segmentRecords.some((record) => (record.cadence ?? 0) > 0);
  const signal: SegmentSignal | null = isPaceSport && hasSpeed
    ? "pace"
    : isSwim
      ? hasCadence ? "stroke" : hasSpeed ? "swim_pace" : null
      : isRide
        ? hasPower ? "power" : hasCadence ? "cadence" : hasSpeed ? "speed" : null
        : hasCadence
          ? ["Ski Erg", "Indoor Rower"].includes(lap.lap_name ?? "") ? "stroke" : "cadence"
          : hasPower ? "power" : hasSpeed ? "speed" : null;
  const signalLabel = signal === "pace" || signal === "swim_pace"
    ? "Pace"
    : signal === "stroke"
      ? "Stroke Rate"
      : signal === "power"
        ? "Power"
        : signal === "speed"
          ? "Speed"
          : "Cadence";
  const signalUnit = signal === "pace"
    ? "/km"
    : signal === "swim_pace"
      ? "/100m"
      : signal === "power"
        ? "W"
        : signal === "speed"
          ? "km/h"
          : "spm";
  const signalValue = (record: RecordPoint): number | undefined => {
    if (signal === "pace" || signal === "swim_pace" || signal === "speed") {
      return record.speed_mps;
    }
    if (signal === "power") return record.power_w;
    if (signal === "stroke" || signal === "cadence") return record.cadence;
    return undefined;
  };
  const formatSignal = (value: number): string => {
    if (signal === "pace") return formatPace(value);
    if (signal === "swim_pace") return formatSwimPace(value);
    if (signal === "speed") return (value * 3.6).toFixed(1);
    return String(Math.round(value));
  };
  const chartData = segmentRecords
    .filter((_, index) => index % sampleRate === 0 || index === segmentRecords.length - 1)
    .map((record) => ({
      time: (record.elapsed_s ?? startElapsed) - startElapsed,
      heartRate: record.heart_rate_bpm,
      rate: signalValue(record),
    }));
  const heartRates = segmentRecords.flatMap((record) =>
    record.heart_rate_bpm != null ? [record.heart_rate_bpm] : [],
  );
  const signalValues = segmentRecords.flatMap((record) => {
    const value = signalValue(record);
    return value != null && value > 0 ? [value] : [];
  });
  const averageSignal = signal === "pace" || signal === "swim_pace" || signal === "speed"
    ? lap.avg_speed_mps
    : signal === "power"
      ? lap.avg_power_w
      : lap.avg_cadence;
  const maxSignal = signalValues.length ? Math.max(...signalValues) : undefined;
  const maxHeartRate = lap.max_hr_bpm ?? (
    heartRates.length ? Math.max(...heartRates) : undefined
  );
  const load = lap.distance_m
    ? lap.load_unit === "reps"
      ? `${Math.round(lap.distance_m)} reps`
      : lap.lap_type === "functional" || isSwim
        ? `${Math.round(lap.distance_m)} m`
        : `${(lap.distance_m / 1000).toFixed(2)} km`
    : "--";
  const metrics: ActivityMetric[] = [
    ["Event time", formatSplitDuration(lap.elapsed_s)],
    ["Max HR", maxHeartRate ?? "--", "bpm"],
    ["Average HR", lap.avg_hr_bpm ?? "--", "bpm"],
    [lap.lap_type === "functional" ? "Load" : "Distance", load],
    ...(signal
      ? [
        [
          signal === "pace" || signal === "swim_pace"
            ? "Best pace"
            : `Max ${signalLabel.toLowerCase()}`,
          maxSignal ? formatSignal(maxSignal) : "--",
          signalUnit,
        ] as ActivityMetric,
        [
          signal === "pace" || signal === "swim_pace"
            ? "Average pace"
            : `Average ${signalLabel.toLowerCase()}`,
          averageSignal ? formatSignal(averageSignal) : "--",
          signalUnit,
        ] as ActivityMetric,
      ]
      : []),
  ];
  const hasHeartRate = chartData.some((point) => point.heartRate != null);
  const hasRate = chartData.some((point) => point.rate != null);

  return (
    <div className="segment-detail">
      {(hasHeartRate || hasRate) && (
        <div className="segment-chart">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 260 }}>
            <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
              <XAxis
                dataKey="time"
                type="number"
                domain={[0, lap.elapsed_s]}
                tickCount={4}
                tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                tickFormatter={(value: number) => formatSplitDuration(value)}
                axisLine={false}
              />
              {hasHeartRate && (
                <YAxis
                  yAxisId="hr"
                  width={58}
                  tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                  domain={["dataMin - 10", "dataMax + 10"]}
                  axisLine={false}
                />
              )}
              {hasRate && (
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  width={64}
                  tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
                  tickFormatter={(value: number) => formatSignal(value)}
                  domain={["auto", "auto"]}
                  axisLine={false}
                />
              )}
              <Tooltip
                labelFormatter={(value) => `${formatSplitDuration(Number(value))} elapsed`}
                formatter={(value, name) =>
                  name === "Heart Rate"
                    ? `${Math.round(Number(value))} bpm`
                    : `${formatSignal(Number(value))} ${signalUnit}`
                }
              />
              {hasHeartRate && (
                <Line
                  yAxisId="hr"
                  type="monotone"
                  dataKey="heartRate"
                  stroke="var(--color-status-critical)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="Heart Rate"
                />
              )}
              {hasRate && (
                <Line
                  yAxisId="rate"
                  type="monotone"
                  dataKey="rate"
                  stroke="var(--color-accent-primary)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name={signalLabel}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="segment-metrics">
        {metrics.map(([label, value, unit]) => (
          <div className="segment-metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            {unit && <em>{unit}</em>}
          </div>
        ))}
      </div>
    </div>
  );
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
  const [activityNote, setActivityNote] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedLapIndex, setExpandedLapIndex] = useState<number | null>(null);
  const [expandedTriathlonLeg, setExpandedTriathlonLeg] = useState<string | null>(null);
  const [selectedDynamicsMetrics, setSelectedDynamicsMetrics] =
    useState<RunningDynamicsKey[]>(["cadence"]);
  const [showTelemetryPopup, setShowTelemetryPopup] = useState(true);
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMapExpanded(false);
      }
    };
    if (isMapExpanded) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isMapExpanded]);
  const sampledRoutePoints = useMemo(() => {
    const routePoints = records
      .filter((record) => record.position_lat != null && record.position_long != null)
      .map((record) => ({
        lat: record.position_lat!,
        lng: record.position_long!,
        elapsed_s: record.elapsed_s,
        heart_rate_bpm: record.heart_rate_bpm,
        speed_mps: record.speed_mps,
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
          setActivityNote(detailData.activity_note || "");
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

  async function saveActivityNote() {
    setIsSavingNote(true);
    setNoteSaveError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/activities/${activityId}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity_note: activityNote }),
      });
      if (!res.ok) throw new Error("Unable to save note");
      const data = await res.json();
      setActivityNote(data.activity_note || "");
      setActivity((current) => current ? { ...current, activity_note: data.activity_note } : current);
    } catch {
      setNoteSaveError("Could not save note. Please try again.");
    }
    setIsSavingNote(false);
  }

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
            <PageTitle>Activity Detail</PageTitle>
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
          <header className="page-header"><PageTitle>Activity Not Found</PageTitle></header>
          <div className="page-body" style={{ textAlign: "center", paddingTop: "var(--space-16)", color: "var(--color-text-muted)" }}>
            <p>Activity details could not be loaded.</p>
            <Link href="/activities" className="btn btn-secondary" style={{ marginTop: "var(--space-4)" }}>Back to Activities</Link>
          </div>
        </main>
      </div>
    );
  }

  const isRun = ["run", "trail_run"].includes(activity.sport);
  const heartRateValues = records.flatMap((record) =>
    record.heart_rate_bpm != null ? [record.heart_rate_bpm] : [],
  );
  const maxHeartRate = activity.max_hr_bpm
    ?? (heartRateValues.length ? Math.max(...heartRateValues) : undefined);
  const DEFAULT_LTHR = 173;
  const effectiveThresholdHr = activity.threshold_hr_bpm ?? DEFAULT_LTHR;
  const heartRateZones = buildHeartRateZones(effectiveThresholdHr);
  const paceZones = isRun && activity.threshold_pace_s_per_km
    ? buildPaceZones(activity.threshold_pace_s_per_km)
    : [];
  const paceValues = records.flatMap((record) =>
    record.speed_mps != null && record.speed_mps > 0
      ? [1000 / record.speed_mps]
      : [],
  );
  const heartRateZoneSummary = summarizeTrainingZones(heartRateValues, heartRateZones);
  const paceZoneSummary = summarizeTrainingZones(paceValues, paceZones);
  const paceChartCeiling = paceZones[0]?.min
    ? paceZones[0].min * 1.45
    : 720;
  const sampleRate = Math.max(1, Math.floor(records.length / 300));
  const chartData = records
    .filter((_, i) => i % sampleRate === 0 || i === records.length - 1)
    .map((record) => {
      const pace = record.speed_mps != null && record.speed_mps > 0
        ? Math.min(1000 / record.speed_mps, paceChartCeiling)
        : undefined;
      const point: Record<string, number | undefined> = {
        time: record.elapsed_s ? record.elapsed_s / 60 : 0,
        hr: record.heart_rate_bpm,
        speed: record.speed_mps
          ? Math.round(record.speed_mps * 3.6 * 10) / 10
          : undefined,
        pace,
        alt: record.altitude_m != null ? Math.round(record.altitude_m) : undefined,
        power: record.power_w,
        power_w: record.power_w,
        cadence: record.cadence,
        ground_time_ms: record.ground_time_ms,
        stride_length_cm: record.stride_length_cm,
        stride_ratio_pct: record.stride_ratio_pct,
        stride_height_cm: record.stride_height_cm,
      };
      const heartRateZone = record.heart_rate_bpm != null
        ? findTrainingZone(heartRateZones, record.heart_rate_bpm)
        : undefined;
      const paceZone = pace != null ? findTrainingZone(paceZones, pace) : undefined;
      if (heartRateZone) point[`hr_${heartRateZone.key}`] = record.heart_rate_bpm;
      if (paceZone) point[`pace_${paceZone.key}`] = pace;
      return point;
    });
  const chartDurationMinutes = Math.max(
    activity.elapsed_time_s ?? 0,
    records[records.length - 1]?.elapsed_s ?? 0,
  ) / 60;
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
  const hasPaceData = chartData.some((point) => point.pace != null);
  const hasTelemetryData = hasHeartRateData || hasSpeedData;
  const availableDynamicsMetrics = RUNNING_DYNAMICS_METRICS.filter((metric) =>
    records.some((record) => record[metric.key] != null),
  );
  const activeDynamicsMetrics = availableDynamicsMetrics.filter((metric) =>
    selectedDynamicsMetrics.includes(metric.key),
  );
  const visibleDynamicsMetrics = activeDynamicsMetrics.length
    ? activeDynamicsMetrics
    : availableDynamicsMetrics.slice(0, 1);
  const dynamicsAverages = visibleDynamicsMetrics.map((metric) => {
    const values = records.flatMap((record) => {
      const value = record[metric.key];
      return value != null && (!metric.ignoreZero || value > 0) ? [value] : [];
    });
    return {
      metric,
      average: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null,
    };
  });
  const toggleDynamicsMetric = (key: RunningDynamicsKey) => {
    setSelectedDynamicsMetrics((selected) =>
      selected.includes(key)
        ? selected.length === 1
          ? selected
          : selected.filter((metric) => metric !== key)
        : [...selected, key],
    );
  };

  const activityTitle = activity.title?.toLocaleLowerCase() ?? "";
  const isStrength = activity.sport === "strength" || activityTitle.includes("strength");
  const isHyrox = !isStrength && (activity.subsport === "1200" || activityTitle.includes("hyrox"));
  const strength = isStrength ? activity.strength_detail : undefined;
  const isSwim = activity.sport === "swim";
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
  const hasStructuredLapPhases = (
    isRun &&
    !isHyrox &&
    activity.laps.some((lap) =>
      ["warmup", "training", "cooldown", "rest"].includes(lap.lap_type ?? ""),
    )
  );
  const lapGroups: ActivityLapGroup[] = activity.laps.map((lap) => ({
    laps: [lap],
    summary: lap,
  }));
  const swimLapNumbers = Object.fromEntries(
    lapGroups
      .filter(({ summary }) => summary.lap_type !== "rest")
      .map(({ summary }, index) => [summary.lap_index, index + 1]),
  );
  const lapTotal = summarizeLapGroup(activity.laps);
  const totalDistance = activity.distance_m ?? lapTotal.distance_m;
  const totalDuration = activity.elapsed_time_s ?? lapTotal.elapsed_s;
  const totalAvgHr = activity.avg_hr_bpm ?? lapTotal.avg_hr_bpm;
  const totalAvgSpeed = activity.avg_speed_mps ?? lapTotal.avg_speed_mps;
  const totalAvgPower = activity.avg_power_w ?? lapTotal.avg_power_w;
  const totalAvgCadence = activity.avg_cadence ?? lapTotal.avg_cadence;
  const triathlonSpeedMetrics: ActivityMetric[] = isTriathlon
    ? triathlonLegDetails.flatMap((leg) => {
      const speed = leg.distance / leg.duration;
      if (!Number.isFinite(speed) || speed <= 0) return [];
      if (leg.sport === "swim") return [["Swim pace", formatSwimPace(speed), "/100m"] as ActivityMetric];
      if (leg.sport === "run") return [["Run pace", formatPace(speed), "/km"] as ActivityMetric];
      return [["Bike speed", (speed * 3.6).toFixed(1), "km/h"] as ActivityMetric];
    })
    : [];
  const sportVisual = getSportVisual(activity.sport, activity.title, activity.subsport);
  const activityTime = new Date(activity.start_time).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const activeSwimLaps = isSwim ? activity.laps.filter((lap) => (lap.distance_m ?? 0) > 0) : [];
  const activeSwimDistance = activeSwimLaps.reduce((total, lap) => total + (lap.distance_m ?? 0), 0);
  const activeSwimDuration = activeSwimLaps.reduce((total, lap) => total + lap.elapsed_s, 0);
  const activeRunLaps = isRun
    ? activity.laps.filter((lap) => (lap.distance_m ?? 0) > 0 && lap.lap_type !== "rest")
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
  const combinedTelemetryCard = hasTelemetryData && (
    <div className={`card activity-zone-card${strength ? "" : " telemetry-card-standalone"}`} id="chart-hr-speed" style={{ marginBottom: strength ? 0 : "var(--space-6)" }}>
      <div className="activity-zone-header">
        <div>
          <span className="card-title">Heart Rate & Speed Telemetry</span>
          {hasHeartRateData && <span className="activity-zone-unit" style={{ marginLeft: "8px" }}>bpm</span>}
          {hasSpeedData && <span className="activity-zone-unit" style={{ marginLeft: "6px", color: "var(--color-text-primary)", fontWeight: 700 }}>• km/h</span>}
        </div>
        <div className="activity-zone-stats">
          {hasHeartRateData && maxHeartRate != null && <span>Max HR <strong className="mono">{maxHeartRate}</strong></span>}
          {hasHeartRateData && activity.avg_hr_bpm != null && <span>Avg HR <strong className="mono">{activity.avg_hr_bpm}</strong></span>}
          {hasSpeedData && activity.avg_speed_mps != null && activity.avg_speed_mps > 0 && (
            <span>Avg Speed <strong className="mono" style={{ color: "var(--color-text-primary)" }}>{(activity.avg_speed_mps * 3.6).toFixed(1)} km/h</strong></span>
          )}
        </div>
      </div>
      <div className="telemetry-chart">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 360 }}>
          <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
            <XAxis dataKey="time" type="number" domain={[0, chartDurationMinutes]} tickCount={6} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} min`} axisLine={false} />
            {hasHeartRateData && <YAxis yAxisId="hr" width={72} padding={{ top: 8, bottom: 8 }} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} bpm`} axisLine={false} domain={["dataMin - 10", "dataMax + 10"]} />}
            {hasSpeedData && <YAxis yAxisId="speed" orientation="right" width={68} padding={{ top: 8, bottom: 8 }} tick={{ fill: "var(--color-text-primary)", fontSize: 11, fontWeight: 700 }} tickFormatter={(value: number) => `${Math.round(value)} km/h`} axisLine={false} />}
            <Tooltip labelFormatter={(value) => `${formatSplitDuration(Number(value) * 60)} elapsed`} />
            {hasHeartRateData && activity.avg_hr_bpm != null && (
              <ReferenceLine yAxisId="hr" y={activity.avg_hr_bpm} stroke="var(--color-status-critical)" strokeDasharray="4 4" />
            )}
            {hasHeartRateData && (
              heartRateZones.length > 0 ? (
                <>
                  <Line yAxisId="hr" type="linear" dataKey="hr" stroke="var(--color-text-muted)" strokeWidth={2} dot={false} name="Heart Rate" tooltipType="none" />
                  {heartRateZones.map((zone) => (
                    <Line key={zone.key} yAxisId="hr" type="linear" dataKey={`hr_${zone.key}`} stroke={zone.color} strokeWidth={2.5} dot={false} connectNulls={false} name={zone.label} />
                  ))}
                </>
              ) : (
                <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="var(--color-status-critical)" strokeWidth={2.5} dot={false} name="Heart Rate (bpm)" />
              )
            )}
            {hasSpeedData && <Line yAxisId="speed" type="monotone" dataKey="speed" stroke="var(--color-text-primary)" strokeWidth={2.5} dot={false} name="Speed (km/h)" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasHeartRateData && heartRateZoneSummary.length > 0 && (
        <ZoneDistribution zones={heartRateZoneSummary} />
      )}
    </div>
  );
  const runTelemetryCards = isRun
    && (hasPaceData || hasHeartRateData || availableDynamicsMetrics.length > 0)
    && (
      <div className="activity-zone-charts" id="chart-pace-hr">
        <div className="activity-zone-overview-grid">
          {hasPaceData && (
            <section className="card activity-zone-card">
              <div className="activity-zone-header">
                <div>
                  <span className="card-title">Pace</span>
                  <span className="activity-zone-unit">min/km</span>
                </div>
                <div className="activity-zone-stats">
                  {activity.threshold_pace_s_per_km != null && (
                    <span>Threshold <strong className="mono">{formatPaceSeconds(activity.threshold_pace_s_per_km)}</strong></span>
                  )}
                  {activity.avg_speed_mps != null && activity.avg_speed_mps > 0 && (
                    <span>Average <strong className="mono">{formatPace(activity.avg_speed_mps)}</strong></span>
                  )}
                </div>
              </div>
              <div className="activity-zone-chart">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 220 }}>
                  <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                    <XAxis dataKey="time" type="number" domain={[0, chartDurationMinutes]} tickCount={6} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} min`} axisLine={false} />
                    <YAxis width={56} reversed domain={["dataMin - 10", paceChartCeiling]} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => formatPaceSeconds(value)} axisLine={false} />
                    <Tooltip formatter={(value) => [formatPaceSeconds(Number(value)), "Pace"]} labelFormatter={(value) => `${formatSplitDuration(Number(value) * 60)} elapsed`} />
                    {activity.avg_speed_mps != null && activity.avg_speed_mps > 0 && (
                      <ReferenceLine y={1000 / activity.avg_speed_mps} stroke="var(--color-status-critical)" strokeDasharray="4 4" />
                    )}
                    {paceZones.length > 0 && <Line type="linear" dataKey="pace" stroke="var(--color-text-muted)" strokeWidth={2} dot={false} name="Pace" tooltipType="none" />}
                    {paceZones.length ? paceZones.map((zone) => (
                      <Line key={zone.key} type="linear" dataKey={`pace_${zone.key}`} stroke={zone.color} strokeWidth={2.5} dot={false} connectNulls={false} name={zone.label} />
                    )) : (
                      <Line type="linear" dataKey="pace" stroke="var(--color-accent-primary)" strokeWidth={2.5} dot={false} name="Pace" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {paceZoneSummary.length > 0 && <ZoneDistribution zones={paceZoneSummary} />}
            </section>
          )}

          {hasHeartRateData && (
            <section className="card activity-zone-card">
              <div className="activity-zone-header">
                <div>
                  <span className="card-title">Heart Rate</span>
                  <span className="activity-zone-unit">bpm</span>
                </div>
                <div className="activity-zone-stats">
                  {maxHeartRate != null && <span>Max <strong className="mono">{maxHeartRate}</strong></span>}
                  {activity.avg_hr_bpm != null && <span>Average <strong className="mono">{activity.avg_hr_bpm}</strong></span>}
                </div>
              </div>
              <div className="activity-zone-chart">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 220 }}>
                  <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                    <XAxis dataKey="time" type="number" domain={[0, chartDurationMinutes]} tickCount={6} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} min`} axisLine={false} />
                    <YAxis width={56} domain={["dataMin - 10", "dataMax + 10"]} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)}`} axisLine={false} />
                    <Tooltip formatter={(value) => [`${Math.round(Number(value))} bpm`, "Heart Rate"]} labelFormatter={(value) => `${formatSplitDuration(Number(value) * 60)} elapsed`} />
                    {activity.avg_hr_bpm != null && (
                      <ReferenceLine y={activity.avg_hr_bpm} stroke="var(--color-status-critical)" strokeDasharray="4 4" />
                    )}
                    {heartRateZones.length > 0 && <Line type="linear" dataKey="hr" stroke="var(--color-text-muted)" strokeWidth={2} dot={false} name="Heart Rate" tooltipType="none" />}
                    {heartRateZones.length ? heartRateZones.map((zone) => (
                      <Line key={zone.key} type="linear" dataKey={`hr_${zone.key}`} stroke={zone.color} strokeWidth={2.5} dot={false} connectNulls={false} name={zone.label} />
                    )) : (
                      <Line type="linear" dataKey="hr" stroke="var(--color-status-critical)" strokeWidth={2.5} dot={false} name="Heart Rate" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {heartRateZoneSummary.length > 0 && <ZoneDistribution zones={heartRateZoneSummary} />}
            </section>
          )}
        </div>

        {visibleDynamicsMetrics.length > 0 && (
          <section className="card activity-zone-card running-dynamics-card">
            <div className="activity-zone-header">
              <div>
                <span className="card-title">Running Dynamics</span>
              </div>
            </div>
            <div className="running-dynamics-tabs" role="group" aria-label="Running dynamics metrics">
              {availableDynamicsMetrics.map((metric) => (
                <button
                  type="button"
                  aria-pressed={visibleDynamicsMetrics.some(({ key }) => key === metric.key)}
                  className={visibleDynamicsMetrics.some(({ key }) => key === metric.key) ? "active" : ""}
                  style={visibleDynamicsMetrics.some(({ key }) => key === metric.key) ? {
                    backgroundColor: `${metric.color}18`,
                    borderColor: metric.color,
                    color: metric.color,
                  } : undefined}
                  key={metric.key}
                  onClick={() => toggleDynamicsMetric(metric.key)}
                >
                  {metric.label}
                </button>
              ))}
            </div>
            <div className="running-dynamics-legend" aria-label="Selected metric averages">
              {dynamicsAverages.map(({ metric, average }) => (
                <span key={metric.key}>
                  <i style={{ background: metric.color }} />
                  {metric.label}
                  {average != null && (
                    <strong className="mono">
                      {formatDynamicsValue(average, metric)} {metric.unit}
                    </strong>
                  )}
                </span>
              ))}
            </div>
            <div className="activity-zone-chart running-dynamics-chart">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height: 260 }}>
                <LineChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                  <XAxis dataKey="time" type="number" domain={[0, chartDurationMinutes]} tickCount={6} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} min`} axisLine={false} />
                  {visibleDynamicsMetrics.map((metric) => (
                    <YAxis key={metric.key} yAxisId={metric.key} hide domain={[0, "dataMax + 10"]} />
                  ))}
                  <Tooltip
                    formatter={(value, name) => {
                      const metric = RUNNING_DYNAMICS_METRICS.find(({ label }) => label === name);
                      return metric
                        ? [`${formatDynamicsValue(Number(value), metric)} ${metric.unit}`, metric.label]
                        : [value, name];
                    }}
                    labelFormatter={(value) => `${formatSplitDuration(Number(value) * 60)} elapsed`}
                  />
                  {visibleDynamicsMetrics.map((metric) => (
                    <Line
                      key={metric.key}
                      yAxisId={metric.key}
                      type="linear"
                      dataKey={metric.key}
                      stroke={metric.color}
                      strokeWidth={2.25}
                      dot={false}
                      activeDot={{ r: 3 }}
                      connectNulls={false}
                      isAnimationActive={false}
                      name={metric.label}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
      </div>
    );
  const telemetryCard = isRun ? runTelemetryCards : combinedTelemetryCard;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <PageTitle>Activity Detail</PageTitle>
        </header>

        <div className="page-body">
          <div className="activity-detail-identity">
            <span className="activity-detail-icon" style={{ background: sportVisual.background, color: sportVisual.color }}>
              <SportIcon sport={activity.sport} title={activity.title} subsport={activity.subsport} />
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
            <div className="card breakdown-card" style={{ marginTop: "var(--space-6)", marginBottom: "var(--space-6)" }}>
              <BreakdownHeader
                title="Strength Breakdown"
                description="Exercise volume and set execution"
                count={strength.exercises_detail.length}
                itemLabel="exercise"
              />
              <div className="strength-exercise-list">
                {strength.exercises_detail.map((exercise, exerciseIndex) => {
                  const totals = exercise.entries.reduce(
                    (sum, entry) => ({
                      volume: sum.volume + entry.reps * entry.weight_kg,
                      work: sum.work + entry.work_s,
                      rest: sum.rest + entry.rest_s,
                      calories: sum.calories + entry.calories,
                    }),
                    { volume: 0, work: 0, rest: 0, calories: 0 },
                  );
                  return (
                    <section className="strength-exercise" key={`${exercise.name_key}-${exerciseIndex}`}>
                      <div className="strength-exercise-header">
                        <div className="breakdown-row-identity">
                          <span className="breakdown-index">{exerciseIndex + 1}</span>
                          <h3>{strengthExerciseName(exercise.name_key, exercise.name)}</h3>
                        </div>
                        <span>{exercise.sets} sets · {exercise.total_reps} reps</span>
                      </div>
                      <div className="table-responsive breakdown-table-wrap">
                        <table className="data-table breakdown-table breakdown-nested-table">
                          <thead><tr><th>Set</th><th>Reps</th><th>Weight</th><th>Time</th><th>Rest</th><th>Calories</th></tr></thead>
                          <tbody>
                            {exercise.entries.map((entry, setIndex) => (
                              <tr key={setIndex}>
                                <td data-label="Set"><span className="lap-split-index">{setIndex + 1}</span></td>
                                <td data-label="Reps" className="mono">{entry.reps}</td>
                                <td data-label="Weight" className="mono">{entry.weight_kg > 0 ? `${entry.weight_kg} kg` : "--"}</td>
                                <td data-label="Time" className="mono">{formatDuration(entry.work_s)}</td>
                                <td data-label="Rest" className="mono">{entry.rest_s > 0 ? formatDuration(entry.rest_s) : "--"}</td>
                                <td data-label="Calories" className="mono">{entry.calories}</td>
                              </tr>
                            ))}
                            <tr className="breakdown-total-row">
                              <td data-label="Summary"><span className="breakdown-total-label">Total</span></td>
                              <td data-label="Reps" className="mono">{exercise.total_reps}</td>
                              <td data-label="Volume" className="mono">{totals.volume > 0 ? `${Math.round(totals.volume * 10) / 10} kg` : "—"}</td>
                              <td data-label="Time" className="mono">{formatDuration(totals.work)}</td>
                              <td data-label="Rest" className="mono">{formatDuration(totals.rest)}</td>
                              <td data-label="Calories" className="mono">{totals.calories}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
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
                    <button
                      type="button"
                      className={`route-replay-button route-replay-toggle-popup${showTelemetryPopup ? " is-active" : ""}`}
                      aria-pressed={showTelemetryPopup}
                      title={showTelemetryPopup ? "Hide Pace & HR popup on green marker" : "Show Pace & HR popup on green marker"}
                      onClick={() => setShowTelemetryPopup((prev) => !prev)}
                    >
                      <svg viewBox="0 0 512 512" aria-hidden="true" style={{ width: 13, height: 13, marginRight: 4 }}>
                        <path d="M464 256H368l-56 160L200 96l-56 160H48" stroke="currentColor" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                      Pace &amp; HR
                    </button>
                  </div>
                  <div style={{ flex: 1, position: "relative", minHeight: "260px", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                    <Map key={activityId} points={sampledRoutePoints} showTelemetryPopup={showTelemetryPopup} onExpand={() => setIsMapExpanded(true)} />
                  </div>
                </div>
              )}

              {isMapExpanded && (
                <div
                  className="map-expanded-modal-backdrop"
                  onClick={() => setIsMapExpanded(false)}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Expanded GPS Route Map"
                >
                  <div
                    className="map-expanded-modal-container"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="map-expanded-modal-header">
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span className="card-title" style={{ fontSize: "13px" }}>GPS Route Overlay</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button
                          type="button"
                          className={`route-replay-button route-replay-toggle-popup${showTelemetryPopup ? " is-active" : ""}`}
                          aria-pressed={showTelemetryPopup}
                          onClick={() => setShowTelemetryPopup((prev) => !prev)}
                        >
                          <svg viewBox="0 0 512 512" aria-hidden="true" style={{ width: 13, height: 13, marginRight: 4 }}>
                            <path d="M464 256H368l-56 160L200 96l-56 160H48" stroke="currentColor" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                          Pace &amp; HR
                        </button>
                        <button
                          type="button"
                          className="route-replay-button route-replay-icon-button"
                          aria-label="Close expanded map view"
                          title="Close (Esc)"
                          onClick={() => setIsMapExpanded(false)}
                        >
                          <svg viewBox="0 0 512 512" aria-hidden="true" style={{ width: 14, height: 14 }}>
                            <path d="M400 112L112 400M112 112l288 288" stroke="currentColor" strokeWidth="40" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="map-expanded-modal-body">
                      <Map key={`${activityId}-expanded`} points={sampledRoutePoints} showTelemetryPopup={showTelemetryPopup} />
                    </div>
                  </div>
                </div>
              )}

              {elevationBounds && (
                <div className="card" id="chart-elevation" style={{ display: "flex", flexDirection: "column" }}>
                  <div className="card-header">
                    <span className="card-title">Elevation Profile</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 16, right: 8, bottom: 16, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-chart-grid)" />
                      <XAxis dataKey="time" type="number" domain={[0, chartDurationMinutes]} tickCount={6} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} min`} axisLine={false} />
                      <YAxis width={52} padding={{ top: 8, bottom: 8 }} domain={[elevationBounds[0] - elevationPadding, elevationBounds[1] + elevationPadding]} tick={{ fill: "var(--color-text-muted)", fontSize: 11 }} tickFormatter={(value: number) => `${Math.round(value)} m`} axisLine={false} />
                      <Tooltip
                        labelFormatter={(value) => `${formatSplitDuration(Number(value) * 60)} elapsed`}
                        formatter={(value) => `${Math.round(Number(value))} m`}
                      />
                      <Line type="monotone" dataKey="alt" stroke="var(--color-status-positive)" strokeWidth={2} dot={false} name="Elevation" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Laps Table */}
          {isTriathlon && (
            <div className="card breakdown-card" style={{ marginBottom: "var(--space-6)" }} id="laps-table">
              <BreakdownHeader
                title="Triathlon Breakdown"
                description="Leg performance with transition timing"
                count={triathlonLegDetails.length}
                itemLabel="leg"
              />
              <div className="table-responsive breakdown-table-wrap">
                <table className="data-table breakdown-table">
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
                      const nextLeg = triathlonLegDetails[index + 1];
                      const nextLabel = nextLeg
                        ? nextLeg.sport === "ride"
                          ? "Bike"
                          : nextLeg.sport[0].toUpperCase() + nextLeg.sport.slice(1)
                        : "";
                      const toggleLeg = (): void =>
                        setExpandedTriathlonLeg(isExpanded ? null : leg.sport);
                      const legHeartRates = leg.laps.flatMap((lap) =>
                        lap.max_hr_bpm != null ? [lap.max_hr_bpm] : [],
                      );
                      const legSummary: ActivityLap = {
                        ...leg.laps[0],
                        elapsed_s: leg.duration,
                        distance_m: leg.distance,
                        avg_hr_bpm: leg.avgHr ?? undefined,
                        max_hr_bpm: legHeartRates.length
                          ? Math.max(...legHeartRates)
                          : undefined,
                        avg_speed_mps: speed,
                        avg_power_w: leg.avgPower ?? undefined,
                        avg_cadence: leg.avgCadence ?? undefined,
                        lap_type: leg.sport === "run" ? "run" : undefined,
                      };

                      return (
                        <Fragment key={`${leg.sport}-${index}`}>
                          <tr
                            className={`lap-summary-row is-clickable${isExpanded ? " is-expanded" : ""}`}
                            onClick={toggleLeg}
                          >
                            <td data-label="Leg">
                              <button
                                type="button"
                                className="lap-expand-button lap-expand-button-plain breakdown-identity-button"
                                aria-expanded={isExpanded}
                                aria-label={`Toggle ${label} lap breakdown`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleLeg();
                                }}
                              >
                                <span className="breakdown-row-identity">
                                  <span className="breakdown-index">{index + 1}</span>
                                  <span className="breakdown-row-label">{label}</span>
                                </span>
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <path d="m4 6 4 4 4-4" />
                                </svg>
                              </button>
                            </td>
                            <td data-label="Distance" className="mono">{(leg.distance / 1000).toFixed(2)} km</td>
                            <td data-label="Duration" className="mono">{formatLegDuration(leg.duration)}</td>
                            <td data-label="Avg HR" className="mono">{leg.avgHr ? `${leg.avgHr} bpm` : "--"}</td>
                            <td data-label="Pace / Speed" className="mono breakdown-primary-metric">{paceOrSpeed}</td>
                            <td data-label="Power / Cadence" className="mono">{leg.sport === "swim" ? leg.avgCadence ? `${leg.avgCadence} spm` : "--" : leg.avgPower ? `${leg.avgPower} W` : "--"}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="lap-split-row">
                              <td colSpan={6}>
                                <SegmentDetail
                                  lap={legSummary}
                                  records={records}
                                  sport={leg.sport}
                                />
                                <div className="segment-splits">
                                  <div className="lap-split-header">
                                    <div>
                                      <div className="lap-split-label">{label} lap breakdown</div>
                                      <div className="lap-split-description">Pacing and output inside this race leg</div>
                                    </div>
                                    <span className="lap-split-count">{leg.laps.length} laps</span>
                                  </div>
                                  <table className="lap-split-table breakdown-nested-table">
                                    <thead><tr><th>Lap</th><th>Distance</th><th>Duration</th><th>Avg HR</th><th>Pace / Speed</th><th>Power / Cadence</th></tr></thead>
                                    <tbody>{leg.laps.map((lap, lapIndex) => (
                                      <tr key={`${lap.lap_index}-${lapIndex}`}>
                                        <td data-label="Lap"><span className="lap-split-index">{lapIndex + 1}</span></td>
                                        <td data-label="Distance">{lap.distance_m ? leg.sport === "swim" ? `${Math.round(lap.distance_m)} m` : `${(lap.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                                        <td data-label="Duration">{formatSplitDuration(lap.elapsed_s)}</td>
                                        <td data-label="Avg HR">{lap.avg_hr_bpm ? `${lap.avg_hr_bpm} bpm` : "--"}</td>
                                        <td data-label="Pace / Speed" className="lap-split-pace">{lap.avg_speed_mps ? leg.sport === "swim" ? formatSwimPace(lap.avg_speed_mps) : leg.sport === "run" ? formatPace(lap.avg_speed_mps) : `${(lap.avg_speed_mps * 3.6).toFixed(1)} km/h` : leg.sport === "run" && lap.distance_m && lap.elapsed_s > 0 ? formatPace(lap.distance_m / lap.elapsed_s) : "--"}</td>
                                        <td data-label="Power / Cadence">{leg.sport === "swim" ? lap.avg_cadence ? `${lap.avg_cadence} spm` : "--" : lap.avg_power_w ? `${lap.avg_power_w} W` : "--"}</td>
                                      </tr>
                                    ))}</tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                          {leg.transition > 0 && (
                            <PhaseRow
                              badge={`T${index + 1}`}
                              title="Transition"
                              description={`${label} to ${nextLabel}`}
                              duration={formatSplitDuration(leg.transition)}
                            />
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isStrength && !isTriathlon && activity.laps.length > 0 && (
            <div className="card breakdown-card" style={{ marginBottom: "var(--space-6)" }} id="laps-table">
              <BreakdownHeader
                title={isHyrox ? "Station Breakdown" : "Split Breakdown"}
                description={
                  isHyrox
                    ? "Run and station performance across the full workout"
                    : hasStructuredLapPhases
                      ? "Workout phases with lap-level execution"
                      : isSwim
                        ? "Interval pacing with length-level execution"
                        : "Lap pacing and output consistency"
                }
                count={lapGroups.length}
                itemLabel={isHyrox ? "station" : hasStructuredLapPhases ? "phase" : "lap"}
              />
              <div className="table-responsive breakdown-table-wrap">
                <table className="data-table breakdown-table">
                  <thead>
                    <tr>
                      <th>{hasStructuredLapPhases ? "Phase" : "Lap"}</th>
                      <th>{isHyrox ? "Load" : "Distance"}</th>
                      <th>Duration</th>
                      <th>Avg HR</th>
                      <th>{isTriathlon ? "Pace / Speed" : isSwim ? "Pace /100m" : "Pace"}</th>
                      <th>{isHyrox ? "Cadence" : isTriathlon ? "Power / Cadence" : isSwim ? "Stroke rate" : hasStructuredLapPhases ? "Power / HRR" : "Power"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lapGroups.map((group, groupIndex) => {
                      const lap = group.summary;
                      const sourceLaps = group.laps;
                      const kilometerSplits = sourceLaps.length === 1
                        ? activity.lap_splits?.[String(lap.lap_index)] ?? []
                        : [];
                      const isExpanded = expandedLapIndex === lap.lap_index;
                      const lapSport = lap.leg ?? activity.sport;
                      const isLapSwim = lapSport === "swim";
                      const isLapPaceSport = lap.lap_type === "run" || ["run", "trail_run", "walk", "hike"].includes(lapSport);
                      const lapNumber = isSwim
                        ? swimLapNumbers[lap.lap_index] ?? groupIndex + 1
                        : hasStructuredLapPhases
                          ? groupIndex + 1
                          : lap.lap_index === 0 ? 1 : lap.lap_index;
                      const legLapNumber = isTriathlon && lap.leg
                        ? activity.laps.filter((candidate) => candidate.leg === lap.leg).indexOf(lap) + 1
                        : lapNumber;
                      const isRest = isLapSwim
                        ? lap.lap_type === "rest" || (!lap.lap_type && (!lap.distance_m || lap.distance_m <= 0))
                        : lap.lap_type === "rest";
                      const isRestPhase = isRest && !isSwim;
                      const heartRateRecovery = formatHeartRateRecovery(lap);

                      if (isRestPhase) {
                        return (
                          <PhaseRow
                            key={`${lap.lap_index}-${groupIndex}`}
                            badge={isSwim ? undefined : `R${lapNumber}`}
                            title="Rest"
                            description="Recovery between intervals"
                            duration={formatSplitDuration(lap.elapsed_s)}
                            avgHr={lap.avg_hr_bpm}
                            heartRateRecovery={heartRateRecovery}
                          />
                        );
                      }

                      const canExpand = (
                        records.length > 0 ||
                        kilometerSplits.length > 1 ||
                        sourceLaps.length > 1
                      );
                      const toggleLap = (): void => setExpandedLapIndex(isExpanded ? null : lap.lap_index);
                      const stepLabel = lap.lap_type
                        ? LAP_TYPE_LABELS[lap.lap_type]
                        : undefined;
                      const lapLabel = lap.lap_name ?? stepLabel ?? (isTriathlon && lap.leg ? `${lap.leg === "ride" ? "Bike" : lap.leg[0].toUpperCase() + lap.leg.slice(1)} ${legLapNumber}` : String(lapNumber));
                      const rowLabel = isHyrox || isSwim ? lapLabel : stepLabel ?? "Lap";

                      return (
                        <Fragment key={`${lap.lap_index}-${groupIndex}`}>
                          <tr
                            className={`lap-summary-row${isRest ? " is-rest" : ""}${isExpanded ? " is-expanded" : ""}${canExpand ? " is-clickable" : ""}`}
                            onClick={canExpand ? toggleLap : undefined}
                          >
                            <td data-label="Lap">
                              {canExpand ? (
                                <button
                                  type="button"
                                  className="lap-expand-button lap-expand-button-plain breakdown-identity-button"
                                  aria-expanded={isExpanded}
                                  aria-label={
                                    isHyrox || isSwim
                                      ? `Toggle details for ${lapLabel}`
                                      : hasStructuredLapPhases
                                        ? `Toggle ${rowLabel} breakdown`
                                        : `Toggle details for lap ${lapNumber}`
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleLap();
                                  }}
                                >
                                  <span className="breakdown-row-identity">
                                    <span className="breakdown-index">{isSwim && isRest ? "" : lapNumber}</span>
                                    <span className="breakdown-row-label">{rowLabel}</span>
                                  </span>
                                  <svg viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="m4 6 4 4 4-4" />
                                  </svg>
                                </button>
                              ) : (
                                <span className="breakdown-row-identity">
                                  <span className="breakdown-index">{isSwim && isRest ? "" : lapNumber}</span>
                                  <span className="breakdown-row-label">{rowLabel}</span>
                                </span>
                              )}
                            </td>
                            <td data-label={isHyrox ? "Load" : "Distance"} className="mono">{lap.distance_m ? lap.load_unit === "reps" ? `${Math.round(lap.distance_m)} reps` : lap.lap_type === "functional" || isLapSwim ? `${Math.round(lap.distance_m)} m` : `${(lap.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                            <td data-label="Duration" className="mono">{isLapSwim ? formatSwimLapDuration(lap.elapsed_s) : `${Math.floor(lap.elapsed_s / 60)}:${String(Math.round(lap.elapsed_s % 60)).padStart(2, "0")}`}</td>
                            <td data-label="Avg HR" className="mono">{lap.avg_hr_bpm ? `${lap.avg_hr_bpm} bpm` : "--"}</td>
                            <td data-label={isSwim ? "Pace /100m" : "Pace"} className="mono breakdown-primary-metric">{lap.avg_speed_mps ? isLapSwim ? formatSwimPace(lap.avg_speed_mps) : isLapPaceSport ? formatPace(lap.avg_speed_mps) : `${(lap.avg_speed_mps * 3.6).toFixed(1)} km/h` : isLapPaceSport && lap.distance_m && lap.elapsed_s > 0 ? formatPace(lap.distance_m / lap.elapsed_s) : "--"}</td>
                            <td data-label={isRest && heartRateRecovery ? "HRR" : isHyrox ? "Cadence" : isSwim ? "Stroke rate" : "Power"} className="mono">{isRest && heartRateRecovery ? heartRateRecovery : isHyrox || isLapSwim ? lap.avg_cadence ? `${lap.avg_cadence} spm` : "--" : lap.avg_power_w ? `${lap.avg_power_w} W` : "--"}</td>
                          </tr>
                          {isExpanded && (
                            <tr className="lap-split-row">
                              <td colSpan={6}>
                                <SegmentDetail
                                  lap={lap}
                                  records={records}
                                  sport={lapSport}
                                />
                                {!isHyrox && sourceLaps.length > 1 ? (
                                  <div className="segment-splits">
                                    <div className="lap-split-header">
                                      <div>
                                        <div className="lap-split-label">{rowLabel} lap breakdown</div>
                                        <div className="lap-split-description">Every recorded lap inside this workout phase</div>
                                      </div>
                                      <span className="lap-split-count">{sourceLaps.length} laps</span>
                                    </div>
                                    <table className="lap-split-table breakdown-nested-table mono">
                                      <thead><tr><th>Lap</th><th>Distance</th><th>Duration</th><th>Pace</th><th>Avg HR</th><th>Power</th></tr></thead>
                                      <tbody>{sourceLaps.map((sourceLap, sourceLapIndex) => (
                                        <tr key={`${sourceLap.lap_index}-${sourceLapIndex}`}>
                                          <td data-label="Lap"><span className="lap-split-index">{sourceLap.lap_index}</span></td>
                                          <td data-label="Distance">{sourceLap.distance_m ? `${(sourceLap.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                                          <td data-label="Duration">{formatSplitDuration(sourceLap.elapsed_s)}</td>
                                          <td data-label="Pace" className="lap-split-pace">{sourceLap.avg_speed_mps ? `${formatPace(sourceLap.avg_speed_mps)}/km` : sourceLap.distance_m && sourceLap.elapsed_s > 0 ? `${formatPace(sourceLap.distance_m / sourceLap.elapsed_s)}/km` : "--"}</td>
                                          <td data-label="Avg HR">{sourceLap.avg_hr_bpm ? `${sourceLap.avg_hr_bpm} bpm` : "--"}</td>
                                          <td data-label="Power">{sourceLap.avg_power_w ? `${sourceLap.avg_power_w} W` : "--"}</td>
                                        </tr>
                                      ))}</tbody>
                                    </table>
                                  </div>
                                ) : !isHyrox && kilometerSplits.length > 1 ? (
                                  <div className="segment-splits">
                                    <div className="lap-split-header">
                                      <div>
                                        <div className="lap-split-label">{isSwim ? "Length breakdown" : "Kilometre breakdown"}</div>
                                        <div className="lap-split-description">{isSwim ? "Pace and heart rate by pool length" : "Pace and heart rate by kilometre"}</div>
                                      </div>
                                      <span className="lap-split-count">{kilometerSplits.length} splits</span>
                                    </div>
                                    <table className="lap-split-table breakdown-nested-table mono">
                                      <thead><tr><th>{isSwim ? "Length" : "Km"}</th><th>Distance</th><th>Duration</th><th>{isSwim ? "Pace /100m" : "Pace"}</th><th>Avg HR</th><th>Max HR</th></tr></thead>
                                      <tbody>{kilometerSplits.map((split, index) => (
                                        <tr key={`${lap.lap_index}-${index}`}>
                                          <td data-label={isSwim ? "Length" : "Km"}><span className="lap-split-index">{index + 1}</span></td>
                                          <td data-label="Distance">{split.distance_m ? isSwim ? `${Math.round(split.distance_m)} m` : `${(split.distance_m / 1000).toFixed(2)} km` : "--"}</td>
                                          <td data-label="Duration">{formatSplitDuration(split.elapsed_s)}</td>
                                          <td data-label={isSwim ? "Pace /100m" : "Pace"} className="lap-split-pace">{split.avg_speed_mps ? isSwim ? formatSwimPace(split.avg_speed_mps) : `${formatPace(split.avg_speed_mps)}/km` : split.distance_m && split.elapsed_s > 0 && !isSwim ? `${formatPace(split.distance_m / split.elapsed_s)}/km` : "--"}</td>
                                          <td data-label="Avg HR">{split.avg_hr_bpm ? `${split.avg_hr_bpm} bpm` : "--"}</td>
                                          <td data-label="Max HR">{split.max_hr_bpm ? `${split.max_hr_bpm} bpm` : "--"}</td>
                                        </tr>
                                      ))}</tbody>
                                    </table>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    <tr className="breakdown-total-row">
                      <td data-label="Summary">
                        <span className="breakdown-total-label">Total</span>
                      </td>
                      <td data-label={isHyrox ? "Load" : "Distance"} className="mono">
                        {totalDistance != null
                          ? isSwim
                            ? `${Math.round(totalDistance)} m`
                            : `${(totalDistance / 1000).toFixed(2)} km`
                          : "—"}
                      </td>
                      <td data-label="Duration" className="mono">{formatSplitDuration(totalDuration)}</td>
                      <td data-label="Avg HR" className="mono">{totalAvgHr ? `${totalAvgHr} bpm` : "—"}</td>
                      <td data-label={isSwim ? "Pace /100m" : "Pace"} className="mono">
                        {totalAvgSpeed
                          ? isSwim
                            ? formatSwimPace(totalAvgSpeed)
                            : isRun
                              ? formatPace(totalAvgSpeed)
                              : `${(totalAvgSpeed * 3.6).toFixed(1)} km/h`
                          : "—"}
                      </td>
                      <td data-label={isHyrox ? "Cadence" : isSwim ? "Stroke rate" : "Power"} className="mono">
                        {isHyrox || isSwim
                          ? totalAvgCadence ? `${totalAvgCadence} spm` : "—"
                          : totalAvgPower ? `${totalAvgPower} W` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <section className="card" style={{ marginTop: "var(--space-6)", marginBottom: "var(--space-6)" }}>
            <div className="card-header">
              <div>
                <span className="card-title">Athlete note</span>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="activity-note-input">What should your coach know?</label>
              <textarea
                id="activity-note-input"
                value={activityNote}
                onChange={(event) => setActivityNote(event.target.value)}
                maxLength={4000}
                rows={4}
                placeholder="How did this activity feel?"
              />
              <span className="settings-help">Add how it felt, any pain, or context that explains the result.</span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-4)" }}>
              <button className="btn btn-secondary btn-sm" type="button" onClick={saveActivityNote} disabled={isSavingNote}>
                {isSavingNote ? "Saving" : "Save note"}
              </button>
            </div>
            {noteSaveError && <p role="alert" style={{ color: "var(--color-error, #dc2626)", marginTop: "var(--space-2)" }}>{noteSaveError}</p>}
          </section>

          {/* AI Performance Analysis */}
          <div className="card ai-analysis-card" id="ai-analysis-card">
            <div className="ai-analysis-header">
              <div className="ai-analysis-heading">
                <span className="ai-analysis-icon">
                  <AiGlyph />
                </span>
                <div>
                  <span className="card-title">AI Performance Analysis</span>
                  {!postmortem && (
                    <span className="ai-analysis-meta">
                      Workout execution, load & recovery
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
                <div className="ai-text">
                  <WaveThinkingText text="evaluating session data & recovery" />
                </div>
              </div>
            )}
            {postmortem && (
              <div className="ai-analysis-response">
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{postmortem}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
