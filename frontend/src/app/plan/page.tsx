"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Sidebar from "@/components/Sidebar";
import PageTitle from "@/components/PageTitle";
import NumberStepper from "@/components/NumberStepper";
import SingleSelect from "@/components/SingleSelect";
import ExerciseCombobox, { type ExerciseOption } from "@/components/ExerciseCombobox";
import { SportIcon, getSportVisual } from "@/components/SportActivityIcon";
import { moveRepeatStep, moveStepAcrossRepeatBoundary, moveWorkoutBlock } from "./workout-order";
import { resolveExerciseName } from "@/lib/exerciseNames";

interface TrainingEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  location: string;
  event_type: "run" | "ride" | "strength" | "swim" | "yoga" | "pilates" | "race" | "other";
  is_all_day: boolean;
  workout_steps?: WorkoutStepForm[];
}

type CalendarSource = "ical" | "coros";
type WorkoutEditorMode = "library" | "structured";
type WorkoutSport = "run" | "ride" | "swim" | "strength" | "trail_run" | "indoor_climb" | "bouldering" | "xc_ski" | "hyrox";
type WorkoutTarget = "time" | "distance" | "load" | "hr_recovery" | "reps" | "open" | "elevation_gain" | "routes";
type WorkoutIntensity = "none" | "heart_rate" | "heart_rate_percent" | "pace" | "effort_pace" | "threshold_pace_percent" | "effort_pace_percent" | "ftp_percent" | "power" | "cadence" | "weight" | "rpe" | "stroke" | "speed" | "grade";
type WorkoutIntensityBasis = "max_hr" | "reserve" | "lthr";

interface WorkoutStepForm {
  kind: "warmup" | "training" | "rest" | "cooldown";
  target: WorkoutTarget;
  value: number;
  name: string;
  exercise_code: string | null;
  exercise_id: string | null;
  sets: number;
  rest_seconds: number;
  repeats: number;
  intensity: WorkoutIntensity;
  intensity_low: number | null;
  intensity_high: number | null;
  intensity_basis: WorkoutIntensityBasis;
  intensity_zone: number | null;
  repeat_group: number | null;
  repeat_count: number | null;
  repeat_name: string | null;
}

interface WorkoutDraftForm {
  date: string;
  name: string;
  sport: WorkoutSport;
  description: string;
  steps: WorkoutStepForm[];
}

interface WorkoutEditorData extends WorkoutDraftForm { uid: string; }
interface LibraryWorkout {
  id: string;
  name: string;
  sport: WorkoutSport;
  step_count?: number | null;
  total_time?: number | null;
  total_distance?: number | null;
  step_kinds?: string[];
}

type WorkoutDragItem = { scope: "block" | "repeat"; index: number };
type CalendarMoveNotice = { kind: "pending" | "success" | "error"; message: string };
type DeleteTarget =
  | { kind: "calendar"; uid: string; name: string }
  | { kind: "library"; workout: LibraryWorkout };

const WORKOUT_ICON_PATHS = {
  calendar: "M3 5h18M7 3v4m10-4v4M5 9h14v12H5z",
  zap: "m13 2-9 12h7l-1 8 9-12h-7z",
  book: "M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3zm16 0a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  close: "M6 6l12 12M18 6 6 18",
  run: "M13 4a2 2 0 1 0 0 .01M7 21l3-7 3 2 2 5m-7-9 3-5 4 3 3 1",
  save: "M6 3h12v18l-6-4-6 4z",
  plus: "M12 5v14M5 12h14",
  copy: "M8 8h11v11H8zM5 16H4V5h11v1",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3z",
  trash: "M4 7h16M10 11v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 13h10l1-13",
} as const;

function WorkoutIcon({ name, size = 16 }: { name: keyof typeof WORKOUT_ICON_PATHS; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={WORKOUT_ICON_PATHS[name]} /></svg>;
}

function WorkoutDragHandle({ onDragStart, onDragEnd }: { onDragStart: (event: DragEvent<HTMLSpanElement>) => void; onDragEnd: () => void }) {
  return <span className="plan-workout-drag-handle" aria-hidden="true" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}><svg width="14" height="22" viewBox="0 0 14 22" fill="currentColor"><circle cx="4" cy="4" r="2" /><circle cx="10" cy="4" r="2" /><circle cx="4" cy="11" r="2" /><circle cx="10" cy="11" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="10" cy="18" r="2" /></svg></span>;
}

const SPORT_OPTIONS: Array<{ value: WorkoutSport; label: string }> = [
  { value: "run", label: "Run" }, { value: "ride", label: "Ride" },
  { value: "swim", label: "Pool Swim" }, { value: "strength", label: "Strength" },
  { value: "trail_run", label: "Trail Run" }, { value: "indoor_climb", label: "Indoor Climb" },
  { value: "bouldering", label: "Bouldering" }, { value: "xc_ski", label: "XC Ski" },
  { value: "hyrox", label: "HYROX" },
];
const INTENSITY_OPTIONS: Array<{ value: WorkoutIntensity; label: string }> = [
  { value: "none", label: "Not set" }, { value: "heart_rate", label: "Heart Rate" },
  { value: "heart_rate_percent", label: "% Heart Rate" }, { value: "pace", label: "Pace" },
  { value: "effort_pace", label: "Effort Pace" }, { value: "threshold_pace_percent", label: "% Threshold Pace" },
  { value: "effort_pace_percent", label: "% Effort Pace" }, { value: "ftp_percent", label: "% FTP" },
  { value: "power", label: "Power" }, { value: "speed", label: "Speed" },
  { value: "cadence", label: "Cadence" }, { value: "stroke", label: "Stroke" },
  { value: "weight", label: "Weight" }, { value: "rpe", label: "RPE" }, { value: "grade", label: "Grade" },
];
const STROKE_OPTIONS = [
  { value: "0", label: "Not set" }, { value: "1", label: "Freestyle" },
  { value: "2", label: "Breaststroke" }, { value: "3", label: "Backstroke" },
  { value: "4", label: "Butterfly" }, { value: "6", label: "Drills" },
  { value: "7", label: "Individual medley" }, { value: "255", label: "Mixed" },
];
const INTENSITY_RANGE: Partial<Record<WorkoutIntensity, { low: string; high?: string; min: number; max: number; step?: number }>> = {
  heart_rate: { low: "Low (bpm)", high: "High (bpm)", min: 30, max: 250 },
  heart_rate_percent: { low: "Low (%)", high: "High (%)", min: 1, max: 300 },
  power: { low: "Low (W)", high: "High (W)", min: 0, max: 3000 },
  cadence: { low: "Low (rpm)", high: "High (rpm)", min: 0, max: 300 },
  pace: { low: "Fast pace (min/km)", high: "Slow pace (min/km)", min: 1, max: 3600 },
  effort_pace: { low: "Fast pace (min/km)", high: "Slow pace (min/km)", min: 1, max: 3600 },
  threshold_pace_percent: { low: "Low (%)", high: "High (%)", min: 1, max: 300 },
  effort_pace_percent: { low: "Low (%)", high: "High (%)", min: 1, max: 300 },
  ftp_percent: { low: "Low (%)", high: "High (%)", min: 1, max: 300 },
  speed: { low: "Low (km/h)", high: "High (km/h)", min: 0, max: 200, step: 0.1 },
  weight: { low: "Weight (kg)", min: 0, max: 2000, step: 0.1 },
  rpe: { low: "RPE (1–10)", min: 1, max: 10 },
  grade: { low: "Relative to onsight", min: -8, max: 4 },
};

type IntensityZone = { id: number; label: string; low: number; high: number };
const HEART_RATE_ZONES: Record<WorkoutIntensityBasis, IntensityZone[]> = {
  max_hr: [{ id: 6, label: "Recovery", low: 0, high: 50 }, { id: 1, label: "Warm Up", low: 51, high: 60 }, { id: 2, label: "Fat Burn", low: 61, high: 70 }, { id: 3, label: "Aerobic Endurance", low: 71, high: 80 }, { id: 4, label: "Threshold", low: 81, high: 90 }, { id: 5, label: "Anaerobic", low: 91, high: 100 }],
  reserve: [{ id: 6, label: "Recovery", low: 0, high: 59 }, { id: 1, label: "Warm Up", low: 60, high: 74 }, { id: 2, label: "Fat Burn", low: 75, high: 84 }, { id: 3, label: "Aerobic Endurance", low: 85, high: 88 }, { id: 4, label: "Threshold", low: 89, high: 95 }, { id: 5, label: "Anaerobic", low: 96, high: 100 }],
  lthr: [{ id: 6, label: "Recovery", low: 0, high: 80 }, { id: 1, label: "Aerobic Endurance", low: 81, high: 90 }, { id: 2, label: "Aerobic Power", low: 91, high: 95 }, { id: 3, label: "Threshold", low: 96, high: 102 }, { id: 4, label: "Anaerobic Endurance", low: 103, high: 106 }, { id: 5, label: "Anaerobic Power", low: 107, high: 120 }],
};
const PACE_ZONES: IntensityZone[] = [{ id: 7, label: "Recovery", low: 0, high: 77 }, { id: 1, label: "Aerobic Endurance", low: 78, high: 87 }, { id: 2, label: "Aerobic Power", low: 88, high: 94 }, { id: 3, label: "Threshold", low: 95, high: 108 }, { id: 5, label: "Anaerobic Endurance", low: 109, high: 118 }, { id: 6, label: "Anaerobic Power", low: 119, high: 200 }];
const FTP_ZONES: IntensityZone[] = [{ id: 1, label: "Recovery", low: 0, high: 55 }, { id: 2, label: "Aerobic Endurance", low: 56, high: 75 }, { id: 3, label: "Aerobic Power", low: 76, high: 90 }, { id: 4, label: "Threshold", low: 91, high: 105 }, { id: 5, label: "Anaerobic Endurance", low: 106, high: 120 }, { id: 6, label: "Anaerobic Power", low: 121, high: 150 }, { id: 7, label: "Sprint", low: 151, high: 300 }];

function intensityZones(intensity: WorkoutIntensity, basis: WorkoutIntensityBasis): IntensityZone[] | null {
  if (intensity === "heart_rate_percent") return HEART_RATE_ZONES[basis];
  if (intensity === "threshold_pace_percent" || intensity === "effort_pace_percent") return PACE_ZONES;
  return intensity === "ftp_percent" ? FTP_ZONES : null;
}

function initialIntensityValues(intensity: WorkoutIntensity): Pick<WorkoutStepForm, "intensity_low" | "intensity_high"> {
  if (intensity === "rpe") return { intensity_low: 5, intensity_high: null };
  if (intensity === "stroke") return { intensity_low: 1, intensity_high: null };
  if (intensity === "grade") return { intensity_low: 0, intensity_high: null };
  return { intensity_low: null, intensity_high: null };
}

function intensitiesFor(sport: WorkoutSport, kind: WorkoutStepForm["kind"]): WorkoutIntensity[] {
  if (sport === "swim") return ["none", "stroke"];
  if (sport === "strength") return kind === "training" ? ["none", "weight"] : ["none"];
  if (sport === "indoor_climb" || sport === "bouldering") return ["grade"];
  if (sport === "xc_ski") return ["none", "heart_rate", "heart_rate_percent", "speed"];
  if (sport === "ride") return ["none", "heart_rate", "heart_rate_percent", "ftp_percent", "speed", "power", "cadence"];
  if (sport === "hyrox") return ["none", "heart_rate", "heart_rate_percent", "threshold_pace_percent", "pace", "effort_pace_percent", "effort_pace", "power", "cadence", "weight", "rpe", "speed"];
  return ["none", "heart_rate", "heart_rate_percent", "threshold_pace_percent", "pace", "effort_pace_percent", "effort_pace", "power", "cadence"];
}

function newWorkoutStep(): WorkoutStepForm {
  return { kind: "training", target: "time", value: 600, name: "", exercise_code: null, exercise_id: null, sets: 1, rest_seconds: 0, repeats: 1, intensity: "none", intensity_low: null, intensity_high: null, intensity_basis: "max_hr", intensity_zone: null, repeat_group: null, repeat_count: null, repeat_name: null };
}

function newStructuredWorkoutDraft(date: string): WorkoutDraftForm {
  return {
    date,
    name: "",
    sport: "run",
    description: "",
    steps: [
      { ...newWorkoutStep(), kind: "warmup", name: "Warm Up" },
      { ...newWorkoutStep(), name: "Training" },
      { ...newWorkoutStep(), kind: "cooldown", name: "Cool Down" },
    ],
  };
}

function targetsFor(sport: WorkoutSport, kind: WorkoutStepForm["kind"], movement = ""): WorkoutTarget[] {
  if (sport === "indoor_climb" || sport === "bouldering") return ["routes", "time", "open"];
  if (kind === "rest") {
    if (sport === "strength" || sport === "hyrox") return ["time", "hr_recovery", "open"];
    if (sport === "trail_run" || sport === "xc_ski") return ["time", "distance", "load", "hr_recovery", "elevation_gain", "open"];
    return ["time", "distance", "load", "hr_recovery", "open"];
  }
  if (sport === "strength") return kind === "training" && ["skierg", "indoorrower", "rower", "t1393", "t1207"].includes(movement.toLowerCase().replace(/[^a-z0-9]+/g, "")) ? ["reps", "time", "distance", "open"] : ["reps", "time", "open"];
  if (sport === "hyrox") return ["time", "distance", "load", "reps", "open"];
  if (sport === "trail_run" || sport === "xc_ski") return ["time", "distance", "load", "elevation_gain", "open"];
  return ["time", "distance", "load", "open"];
}

function isHyroxFunctionalStation(name: string): boolean {
  return ["skierg", "sledpush", "sledpull", "burpee", "burpeebroadjumps", "indoorrower", "rower", "farmerswalk", "farmerscarry", "dumbbelllunges", "sandbaglunges", "wallballs"].includes(name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

function targetLabel(target: WorkoutTarget): string {
  return { time: "Time (seconds)", distance: "Distance (km)", load: "Training load", hr_recovery: "HR recovery (bpm)", reps: "Reps", open: "Open", elevation_gain: "Elevation gain (meters)", routes: "Routes" }[target];
}

function targetValueLabel(target: WorkoutTarget): string {
  return { time: "Duration (min:sec)", distance: "Distance (km)", load: "Training load", hr_recovery: "Recovery heart rate (bpm)", reps: "Repetitions", open: "", elevation_gain: "Elevation gain (meters)", routes: "Routes" }[target];
}

function formatKilometers(meters: number): string {
  if (meters > 0 && meters < 1000) {
    return `${meters.toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;
  }
  return `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function parseDuration(value: string): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function DurationInput({ seconds, onChange, ariaLabel = "Duration in minutes and seconds" }: { seconds: number; onChange: (seconds: number) => void; ariaLabel?: string }) {
  const [value, setValue] = useState(() => formatDuration(seconds));

  return <input type="text" inputMode="numeric" placeholder="0:00" value={value} aria-label={ariaLabel} onChange={(event) => { const next = event.target.value; setValue(next); const parsed = parseDuration(next); if (parsed !== null) onChange(parsed); }} onBlur={() => setValue(formatDuration(parseDuration(value) ?? seconds))} />;
}

function structureValue(step: WorkoutStepForm): string {
  if (step.target === "time") return formatDuration(step.value);
  if (step.target === "distance") return formatKilometers(step.value);
  if (step.target === "elevation_gain") return `${step.value.toLocaleString()} m`;
  if (step.target === "reps" || step.target === "routes") return `${step.value} ${step.target}`;
  return step.target === "open" ? "Open" : String(step.value);
}

function intensityValue(step: WorkoutStepForm): string {
  const label = INTENSITY_OPTIONS.find((item) => item.value === step.intensity)?.label ?? "Open intensity";
  if (step.intensity === "none" || step.intensity_low === null || step.intensity_low === undefined) return label;
  if (step.intensity === "stroke") return STROKE_OPTIONS.find((item) => item.value === String(step.intensity_low))?.label ?? label;
  const isSingleValue = step.intensity_high === null || step.intensity_high === step.intensity_low;
  if (step.intensity === "pace" || step.intensity === "effort_pace") return `${label} ${formatDuration(step.intensity_low)}${isSingleValue ? "" : `\u2013${formatDuration(step.intensity_high!)}`} /km`;
  const value = isSingleValue ? step.intensity_low : `${step.intensity_low}\u2013${step.intensity_high}`;
  const unit = step.intensity === "heart_rate" ? " bpm" : step.intensity.endsWith("percent") ? "%" : step.intensity === "power" ? " W" : step.intensity === "cadence" ? " rpm" : step.intensity === "weight" ? " kg" : step.intensity === "speed" ? " km/h" : "";
  return `${label} ${value}${unit}`;
}

function stepSummary(step: WorkoutStepForm): string {
  const summary = [step.target === "open" ? targetLabel(step.target) : `${targetLabel(step.target)} · ${structureValue(step)}`];
  if (step.intensity !== "none" && step.intensity_low !== null && step.intensity_low !== undefined) summary.push(intensityValue(step));
  if (step.kind === "training" && step.sets > 1) summary.push(`${step.sets} sets`);
  if (step.kind === "training" && step.rest_seconds > 0) summary.push(`${formatDuration(step.rest_seconds)} rest`);
  return summary.join(" · ");
}

function formatEventNote(event: TrainingEvent): string {
  if (!event.description) return "";
  if (event.workout_steps?.length) {
    const totalMeters = event.workout_steps.reduce(
      (sum, step) => sum + (step.target === "distance" ? step.value * (step.repeat_count ?? 1) : 0),
      0
    );
    if (totalMeters > 0) {
      const correctKm = `${(totalMeters / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`;
      return event.description.replace(/^[\d.]+\s*km/, correctKm);
    }
  }
  return event.description;
}

function WorkoutStructure({ steps }: { steps: WorkoutStepForm[] }) {
  const groups = new Set<number>();
  const totalDistance = steps.reduce((total, step) => total + (step.target === "distance" ? step.value * (step.repeat_count ?? 1) : 0), 0);
  const barGroups = new Set<number>();
  const barSteps = steps.flatMap((step) => {
    if (step.repeat_group === null || step.repeat_group === undefined) return [step];
    if (barGroups.has(step.repeat_group)) return [];
    barGroups.add(step.repeat_group);
    const children = steps.filter((item) => item.repeat_group === step.repeat_group);
    return Array.from({ length: step.repeat_count ?? 1 }, () => children).flat();
  });
  const card = (step: WorkoutStepForm, key: string, nested = false) => <div className={`plan-day-workout-step is-${step.kind}${nested ? " is-nested" : ""}`} key={key}><div><strong>{displayStepName(step)}</strong><small>{intensityValue(step)}</small></div><b>{structureValue(step)}</b></div>;
  return <section className="plan-day-workout-structure"><header><strong>Workout structure</strong>{totalDistance > 0 && <span>{formatKilometers(totalDistance)} total</span>}</header><div className="plan-day-workout-bar" aria-hidden="true">{barSteps.map((step, index) => <i key={`${step.kind}-${index}`} data-kind={step.kind} style={{ flexGrow: Math.max(1, step.value) }} />)}</div><div className="plan-day-workout-legend"><span data-kind="warmup">Warm-up</span><span data-kind="training">Main</span><span data-kind="rest">Rest</span><span data-kind="cooldown">Cool-down</span></div><div className="plan-day-workout-steps">{steps.map((step, index) => {
    if (step.repeat_group === null || step.repeat_group === undefined) return card(step, `step-${index}`);
    if (groups.has(step.repeat_group)) return null;
    groups.add(step.repeat_group);
    const children = steps.filter((item) => item.repeat_group === step.repeat_group);
    return <div className="plan-day-workout-repeat" key={`repeat-${step.repeat_group}`}><header><strong>Repeat ×{step.repeat_count ?? 1}</strong><span>{children.map(structureValue).join(" · ")}</span></header>{children.map((item, childIndex) => card(item, `repeat-${step.repeat_group}-${childIndex}`, true))}</div>;
  })}</div></section>;
}

function friendlyStepName(kind: WorkoutStepForm["kind"]): string {
  return { warmup: "Warm Up", training: "Training", rest: "Rest", cooldown: "Cool Down" }[kind];
}

function displayStepName(step: WorkoutStepForm): string {
  return step.exercise_code
    ? resolveExerciseName(step.exercise_code, step.name)
    : step.name.trim() || friendlyStepName(step.kind);
}

function exerciseVideo(name: string, videos: Record<string, string>, options: ExerciseOption[] = []): string | null {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (videos[key]) return videos[key];
  const matched = options.find(
    (opt) =>
      opt.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === key ||
      resolveExerciseName(opt.name, opt.name).toLowerCase().replace(/[^a-z0-9]+/g, "") === key
  );
  return matched?.video_url ?? null;
}

function normalizeLoadedDraft(draft: WorkoutEditorData): WorkoutDraftForm {
  const loadedSets = draft.sport === "strength";
  return {
    ...draft,
    steps: draft.steps.map((step) => {
      const percentIntensity = step.intensity.endsWith("percent");
      const normalizePercent = (value: number | null) => percentIntensity && value != null && Math.abs(value) > 500 ? value / 1000 : value;
      return {
      ...step,
      intensity_low: normalizePercent(step.intensity_low),
      intensity_high: normalizePercent(step.intensity_high),
      name: step.exercise_code ? resolveExerciseName(step.exercise_code, step.name) : /^[TS]\d+$/i.test(step.name.trim()) ? friendlyStepName(step.kind) : step.name,
      exercise_code: step.exercise_code ?? null,
      exercise_id: step.exercise_id ?? null,
      sets: step.sets ?? (loadedSets && step.kind === "training" ? Math.max(1, step.repeats) : 1),
      rest_seconds: step.rest_seconds ?? 0,
      intensity_basis: step.intensity_basis ?? "max_hr",
      intensity_zone: step.intensity_zone ?? null,
      };
    }),
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDays(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const sundayOffset = firstOfMonth.getDay();
  const firstCell = new Date(firstOfMonth);
  firstCell.setDate(firstOfMonth.getDate() - sundayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  });
}

function daysBetween(first: Date, second: Date): number {
  return Math.round((second.getTime() - first.getTime()) / 86_400_000);
}

function formatTime(iso: string, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function mapEmbedUrl(location: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(location)}&output=embed`;
}

function mapSearchUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

export default function TrainingPlanPage() {
  const today = useMemo(() => new Date(), []);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [source, setSource] = useState<CalendarSource>("coros");
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarMoveNotice, setCalendarMoveNotice] = useState<CalendarMoveNotice | null>(null);
  const [draggedCalendarWorkout, setDraggedCalendarWorkout] = useState<TrainingEvent | null>(null);
  const [calendarDropDate, setCalendarDropDate] = useState<string | null>(null);
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutDraftForm | null>(null);
  const [workoutEditorMode, setWorkoutEditorMode] = useState<WorkoutEditorMode>("library");
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [libraryWorkouts, setLibraryWorkouts] = useState<LibraryWorkout[]>([]);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [selectedLibraryWorkoutId, setSelectedLibraryWorkoutId] = useState<string | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [deletingLibraryWorkoutId, setDeletingLibraryWorkoutId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isSavingWorkout, setIsSavingWorkout] = useState(false);
  const [isLoadingWorkoutEditor, setIsLoadingWorkoutEditor] = useState(false);
  const [workoutLoadError, setWorkoutLoadError] = useState("");
  const [structuredSaveToLibrary, setStructuredSaveToLibrary] = useState(false);
  const [activeWorkoutStep, setActiveWorkoutStep] = useState<number | null>(0);
  const [activeExerciseVideoStep, setActiveExerciseVideoStep] = useState<number | null>(null);
  const [draggedWorkoutItem, setDraggedWorkoutItem] = useState<WorkoutDragItem | null>(null);
  const [dropTargetWorkoutItem, setDropTargetWorkoutItem] = useState<WorkoutDragItem | null>(null);
  const [workoutDraftCache, setWorkoutDraftCache] = useState<Partial<Record<"structured", WorkoutDraftForm>>>({});
  const [exerciseVideos, setExerciseVideos] = useState<Record<string, string>>({});
  const [exerciseVideosLoaded, setExerciseVideosLoaded] = useState(false);
  const [exerciseOptions, setExerciseOptions] = useState<ExerciseOption[]>([]);
  const [exerciseOptionsLoading, setExerciseOptionsLoading] = useState(false);
  const [exerciseOptionsLoaded, setExerciseOptionsLoaded] = useState(false);
  const [workoutError, setWorkoutError] = useState("");
  const editRequestRef = useRef<AbortController | null>(null);

  const days = useMemo(() => calendarDays(anchor), [anchor]);
  const firstDate = days[0];
  const lastDate = days[days.length - 1];
  const todayKey = localDateKey(today);

  useEffect(() => {
    async function fetchCalendarData() {
      setIsLoading(true);
      setError("");
      const daysBack = Math.max(0, daysBetween(firstDate, today));
      const daysForward = Math.max(0, daysBetween(today, lastDate));
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

      try {
        const eventsResponse = await fetch(
          `${apiBase}/api/training-plan/events?days_back=${daysBack}&days_forward=${daysForward}&source=${source}`
        );
        if (!eventsResponse.ok) throw new Error(`HTTP ${eventsResponse.status}`);
        const eventData: TrainingEvent[] = await eventsResponse.json();
        setEvents(eventData);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load calendar.");
      } finally {
        setIsLoading(false);
      }
    }
    void fetchCalendarData();
  }, [firstDate, lastDate, source]);

  useEffect(() => {
    if (!calendarMoveNotice || calendarMoveNotice.kind === "pending") return;
    const timeout = window.setTimeout(() => setCalendarMoveNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [calendarMoveNotice]);

  useEffect(() => {
    if (!workoutDraft || exerciseVideosLoaded) return;
    const controller = new AbortController();
    void fetch(`${apiBase}/api/training-plan/coros/exercise-videos`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<Record<string, string>> : {})
      .then((videos) => setExerciseVideos(videos))
      .catch(() => undefined)
      .finally(() => setExerciseVideosLoaded(true));
    return () => controller.abort();
  }, [apiBase, exerciseVideosLoaded, workoutDraft]);

  useEffect(() => {
    if (workoutDraft?.sport !== "strength") {
      setExerciseOptions([]);
      setExerciseOptionsLoaded(false);
      setExerciseOptionsLoading(false);
      return;
    }
    if (exerciseOptionsLoaded) return;
    let active = true;
    setExerciseOptionsLoading(true);
    void fetch(`${apiBase}/api/training-plan/coros/exercises`)
      .then((response) => (response.ok ? (response.json() as Promise<ExerciseOption[]>) : []))
      .then((options) => {
        if (active) setExerciseOptions(options);
      })
      .catch(() => {
        if (active) setExerciseOptions([]);
      })
      .finally(() => {
        if (active) {
          setExerciseOptionsLoading(false);
          setExerciseOptionsLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [apiBase, exerciseOptionsLoaded, workoutDraft?.sport]);

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, TrainingEvent[]> = {};
    for (const event of events) {
      const key = event.start.slice(0, 10);
      (grouped[key] ??= []).push(event);
    }
    return grouped;
  }, [events]);
  const selectedPlans = eventsByDate[selectedDate] ?? [];
  const monthLabel = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const moveMonth = (offset: number) => {
    setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };
  const returnToToday = () => {
    setAnchor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
  };
  const openNewWorkout = (date?: string) => {
    const targetDate = date ?? selectedDate;
    setSelectedDate(targetDate);
    setWorkoutError("");
    setWorkoutLoadError("");
    setEditingUid(null);
    setWorkoutEditorMode("library");
    const structuredDraft = newStructuredWorkoutDraft(targetDate);
    setWorkoutDraft(structuredDraft);
    setWorkoutDraftCache({ structured: structuredDraft });
    setLibraryFilter("");
    setSelectedLibraryWorkoutId(null);
    setStructuredSaveToLibrary(false);
    setActiveWorkoutStep(0);
    setActiveExerciseVideoStep(null);
    if (libraryWorkouts.length === 0 && !isLoadingLibrary) void loadLibraryWorkouts();
  };
  const openEditWorkout = async (uid: string) => {
    const event = events.find((item) => item.uid === uid);
    const controller = new AbortController();
    editRequestRef.current?.abort();
    editRequestRef.current = controller;
    setWorkoutError("");
    setWorkoutLoadError("");
    setEditingUid(uid);
    setWorkoutEditorMode("structured");
    setWorkoutDraft(newStructuredWorkoutDraft(event?.start.slice(0, 10) ?? selectedDate));
    setActiveWorkoutStep(null);
    setActiveExerciseVideoStep(null);
    setIsLoadingWorkoutEditor(true);
    try {
      const response = await fetch(`${apiBase}/api/training-plan/coros/workouts/${encodeURIComponent(uid)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: WorkoutEditorData = await response.json();
      if (controller.signal.aborted) return;
      setEditingUid(data.uid);
      setWorkoutEditorMode("structured");
      setWorkoutDraft(normalizeLoadedDraft(data));
      setActiveWorkoutStep(0);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setWorkoutLoadError(cause instanceof Error ? cause.message : "Could not load this workout.");
    } finally {
      if (editRequestRef.current === controller) {
        editRequestRef.current = null;
        setIsLoadingWorkoutEditor(false);
      }
    }
  };
  const closeWorkoutEditor = () => {
    editRequestRef.current?.abort();
    editRequestRef.current = null;
    setIsLoadingWorkoutEditor(false);
    setWorkoutLoadError("");
    setWorkoutDraft(null);
    setActiveExerciseVideoStep(null);
  };
  const loadLibraryWorkouts = async () => {
    setWorkoutError("");
    setIsLoadingLibrary(true);
    try {
      const response = await fetch(`${apiBase}/api/training-plan/coros/library`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLibraryWorkouts(await response.json() as LibraryWorkout[]);
    } catch (cause) {
      setWorkoutError(cause instanceof Error ? cause.message : "Could not load saved workouts.");
    } finally {
      setIsLoadingLibrary(false);
    }
  };
  const openLibraryWorkout = async (programId: string) => {
    if (!workoutDraft) return;
    setWorkoutError("");
    setIsSavingWorkout(true);
    try {
      const response = await fetch(`${apiBase}/api/training-plan/coros/library/${encodeURIComponent(programId)}?date=${workoutDraft.date}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: WorkoutEditorData = await response.json();
      const draft = { ...normalizeLoadedDraft(data), date: workoutDraft.date };
      setWorkoutDraft(draft);
      setWorkoutDraftCache({ structured: draft });
      setWorkoutEditorMode("structured");
      setActiveWorkoutStep(0);
    } catch (cause) {
      setWorkoutError(cause instanceof Error ? cause.message : "Could not open saved workout.");
    } finally {
      setIsSavingWorkout(false);
    }
  };
  const deleteLibraryWorkout = async (workout: LibraryWorkout) => {
    setDeletingLibraryWorkoutId(workout.id);
    try {
      const response = await fetch(`${apiBase}/api/training-plan/coros/library/${encodeURIComponent(workout.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } finally {
      setDeletingLibraryWorkoutId(null);
    }
  };
  const saveWorkout = async () => {
    if (!workoutDraft) return;
    const draft = { ...workoutDraft, name: workoutDraft.name.trim() || "Structured Workout" };
    const previous = editingUid ? events.find((event) => event.uid === editingUid) : undefined;
    const pendingUid = `pending:${Date.now()}`;
    const pending: TrainingEvent = {
      uid: editingUid ?? pendingUid,
      summary: draft.name,
      start: draft.date,
      end: draft.date,
      description: draft.description,
      location: "",
      event_type: draft.sport === "ride" ? "ride" : draft.sport === "swim" ? "swim" : draft.sport === "strength" || draft.sport === "hyrox" ? "strength" : "run",
      is_all_day: true,
      workout_steps: draft.steps,
    };
    setIsSavingWorkout(true);
    setWorkoutError("");
    setEvents((current) => previous ? current.map((event) => event.uid === previous.uid ? pending : event) : [...current, pending]);
    setSelectedDate(draft.date);
    setWorkoutDraft(null);
    setCalendarMoveNotice({ kind: "pending", message: "Saving workout…" });
    try {
      const method = editingUid ? "PUT" : "POST";
      const path = editingUid
        ? `/api/training-plan/coros/workouts/${encodeURIComponent(editingUid)}`
        : "/api/training-plan/coros/workouts";
      const response = await fetch(`${apiBase}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          confirmed: true,
          save_to_library: structuredSaveToLibrary,
        }),
      });
      if (!response.ok) throw new Error((await response.json() as { detail?: string }).detail || `HTTP ${response.status}`);
      const saved: TrainingEvent = await response.json();
      setEvents((current) => current.map((event) => event.uid === pending.uid ? saved : event));
      setCalendarMoveNotice({ kind: "success", message: `${saved.summary} saved.` });
    } catch (cause) {
      setEvents((current) => previous ? current.map((event) => event.uid === pending.uid ? previous : event) : current.filter((event) => event.uid !== pendingUid));
      setEditingUid(editingUid);
      setWorkoutEditorMode("structured");
      setWorkoutDraft(draft);
      setWorkoutError(cause instanceof Error ? cause.message : "Could not save workout.");
      setCalendarMoveNotice({ kind: "error", message: "Could not save workout." });
    } finally {
      setIsSavingWorkout(false);
    }
  };
  const moveWorkoutToDate = async (uid: string, date: string) => {
    const previous = events.find((event) => event.uid === uid);
    if (!previous) return;
    const optimistic = { ...previous, start: date, end: date };
    setEvents((current) => current.map((event) => event.uid === uid ? optimistic : event));
    setSelectedDate(date);
    setCalendarMoveNotice({ kind: "pending", message: `Moving ${previous.summary} to ${new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}…` });
    try {
      const response = await fetch(`${apiBase}/api/training-plan/coros/workouts/${encodeURIComponent(uid)}/move`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, confirmed: true }),
      });
      if (!response.ok) throw new Error((await response.json() as { detail?: string }).detail || `HTTP ${response.status}`);
      const moved: TrainingEvent = await response.json();
      setEvents((current) => current.map((event) => event.uid === uid ? moved : event));
      setCalendarMoveNotice({ kind: "success", message: `${previous.summary} moved successfully.` });
    } catch (cause) {
      setEvents((current) => current.map((event) => event.uid === uid ? previous : event));
      setSelectedDate(previous.start.slice(0, 10));
      setCalendarMoveNotice({ kind: "error", message: cause instanceof Error ? cause.message : "Could not move workout." });
    }
  };

  const beginCalendarWorkoutDrag = (event: DragEvent<HTMLSpanElement>, workout: TrainingEvent) => {
    if (workout.start.slice(0, 10) < todayKey) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", workout.uid);
    setDraggedCalendarWorkout(workout);
  };
  const allowCalendarWorkoutDrop = (event: DragEvent<HTMLElement>, date: string) => {
    if (!draggedCalendarWorkout || date < todayKey || draggedCalendarWorkout.start.slice(0, 10) === date) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setCalendarDropDate(date);
  };
  const dropCalendarWorkout = (event: DragEvent<HTMLElement>, date: string) => {
    event.preventDefault();
    event.stopPropagation();
    const workout = draggedCalendarWorkout;
    setDraggedCalendarWorkout(null);
    setCalendarDropDate(null);
    if (workout && workout.start.slice(0, 10) !== date) void moveWorkoutToDate(workout.uid, date);
  };
  const deleteWorkout = async (uid: string) => {
    const response = await fetch(`${apiBase}/api/training-plan/coros/workouts/${encodeURIComponent(uid)}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
    });
    if (!response.ok) throw new Error((await response.json() as { detail?: string }).detail || `HTTP ${response.status}`);
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.kind === "library") {
      const index = libraryWorkouts.findIndex((workout) => workout.id === target.workout.id);
      const wasSelected = selectedLibraryWorkoutId === target.workout.id;
      setWorkoutError("");
      setLibraryWorkouts((workouts) => workouts.filter((workout) => workout.id !== target.workout.id));
      if (wasSelected) setSelectedLibraryWorkoutId(null);
      void deleteLibraryWorkout(target.workout).catch((cause) => {
        setLibraryWorkouts((workouts) => index < 0 || workouts.some((workout) => workout.id === target.workout.id) ? workouts : [
          ...workouts.slice(0, index), target.workout, ...workouts.slice(index),
        ]);
        if (wasSelected) setSelectedLibraryWorkoutId(target.workout.id);
        setWorkoutError(cause instanceof Error ? cause.message : "Could not delete saved workout.");
      });
      return;
    }
    const previous = events.find((event) => event.uid === target.uid);
    if (!previous) return;
    setEvents((current) => current.filter((event) => event.uid !== target.uid));
    setCalendarMoveNotice({ kind: "pending", message: `Deleting ${previous.summary}…` });
    void deleteWorkout(target.uid).then(
      () => setCalendarMoveNotice({ kind: "success", message: `${previous.summary} deleted.` }),
      (cause: unknown) => {
        setEvents((current) => current.some((event) => event.uid === previous.uid) ? current : [...current, previous]);
        setCalendarMoveNotice({ kind: "error", message: cause instanceof Error ? cause.message : "Could not delete workout." });
      },
    );
  };
  const updateStep = (index: number, update: Partial<WorkoutStepForm>) => {
    if (!workoutDraft) return;
    setWorkoutDraft({ ...workoutDraft, steps: workoutDraft.steps.map((step, position) => position === index ? { ...step, ...update } : step) });
  };
  const addRepeatBlock = () => {
    if (!workoutDraft) return;
    const group = Math.max(0, ...workoutDraft.steps.map((step) => step.repeat_group ?? 0)) + 1;
    const training = { ...newWorkoutStep(), repeat_group: group, repeat_count: 2, repeat_name: "Repeat" };
    const rest = { ...newWorkoutStep(), kind: "rest" as const, target: "time" as const, value: 120, name: "Rest", repeat_group: group, repeat_count: 2, repeat_name: "Repeat" };
    setWorkoutDraft({ ...workoutDraft, steps: [...workoutDraft.steps, training, rest] });
  };
  const addWorkoutStep = (kind: WorkoutStepForm["kind"]) => {
    if (!workoutDraft) return;
    const step = { ...newWorkoutStep(), kind, name: friendlyStepName(kind), value: kind === "rest" ? 120 : 600 };
    setWorkoutDraft({ ...workoutDraft, steps: [...workoutDraft.steps, step] });
  };
  const updateRepeatBlock = (group: number, repeat_count: number) => {
    if (!workoutDraft) return;
    setWorkoutDraft({ ...workoutDraft, steps: workoutDraft.steps.map((step) => step.repeat_group === group ? { ...step, repeat_count } : step) });
  };
  const duplicateStep = (index: number) => {
    if (!workoutDraft) return;
    const steps = [...workoutDraft.steps];
    steps.splice(index + 1, 0, { ...steps[index] });
    setWorkoutDraft({ ...workoutDraft, steps });
    setActiveWorkoutStep(index + 1);
  };
  const beginWorkoutDrag = (event: DragEvent<HTMLElement>, item: WorkoutDragItem) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${item.scope}:${item.index}`);
    const card = event.currentTarget.closest(".plan-workout-step, .plan-workout-repeat");
    if (card) {
      const bounds = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(card, event.clientX - bounds.left, event.clientY - bounds.top);
    }
    setDraggedWorkoutItem(item);
  };
  const allowWorkoutDrop = (event: DragEvent<HTMLElement>, item: WorkoutDragItem) => {
    event.stopPropagation();
    if (!draggedWorkoutItem || draggedWorkoutItem.index === item.index) return;
    const source = workoutDraft?.steps[draggedWorkoutItem.index];
    const target = workoutDraft?.steps[item.index];
    if (!source || !target) return;
    const movesIntoRepeat = draggedWorkoutItem.scope === "block" && source.repeat_group === null && item.scope === "repeat";
    const movesOutOfRepeat = draggedWorkoutItem.scope === "repeat" && source.repeat_group !== null && item.scope === "block" && target.repeat_group === null;
    if (draggedWorkoutItem.scope !== item.scope && !movesIntoRepeat && !movesOutOfRepeat) return;
    if (draggedWorkoutItem.scope === item.scope && item.scope === "repeat" && source.repeat_group !== target.repeat_group) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetWorkoutItem(item);
  };
  const finishWorkoutDrop = (event: DragEvent<HTMLElement>, item: WorkoutDragItem) => {
    event.stopPropagation();
    event.preventDefault();
    if (!workoutDraft || !draggedWorkoutItem) return;
    const source = workoutDraft.steps[draggedWorkoutItem.index];
    const target = workoutDraft.steps[item.index];
    if (!source || !target) return;
    const steps = draggedWorkoutItem.scope === item.scope
      ? item.scope === "repeat"
        ? moveRepeatStep(workoutDraft.steps, draggedWorkoutItem.index, item.index)
        : moveWorkoutBlock(workoutDraft.steps, draggedWorkoutItem.index, item.index)
      : draggedWorkoutItem.scope === "block" && source.repeat_group === null && item.scope === "repeat"
        ? moveStepAcrossRepeatBoundary(workoutDraft.steps, draggedWorkoutItem.index, item.index)
        : draggedWorkoutItem.scope === "repeat" && source.repeat_group !== null && item.scope === "block" && target.repeat_group === null
          ? moveStepAcrossRepeatBoundary(workoutDraft.steps, draggedWorkoutItem.index, item.index)
          : workoutDraft.steps;
    setWorkoutDraft({ ...workoutDraft, steps });
    setActiveWorkoutStep(null);
    setDraggedWorkoutItem(null);
    setDropTargetWorkoutItem(null);
  };
  const endWorkoutDrag = () => {
    setDraggedWorkoutItem(null);
    setDropTargetWorkoutItem(null);
  };
  const stepEditor = (step: WorkoutStepForm, index: number, nested = false) => {
    if (!workoutDraft) return null;
    const targets = targetsFor(workoutDraft.sport, step.kind, step.exercise_code ?? step.name);
    const video = exerciseVideo(step.name, exerciseVideos, exerciseOptions);
    const isVideoOpen = activeExerciseVideoStep === index;
    const isActive = activeWorkoutStep === index;
    const dragItem: WorkoutDragItem = { scope: nested ? "repeat" : "block", index };
    const isDragging = draggedWorkoutItem?.scope === dragItem.scope && draggedWorkoutItem.index === index;
    const isDropTarget = dropTargetWorkoutItem?.scope === dragItem.scope && dropTargetWorkoutItem.index === index;
    const isStrengthMovement = workoutDraft.sport === "strength" && step.kind === "training";
    const hasCustomStepTitle = workoutDraft.sport !== "strength" && workoutDraft.sport !== "hyrox";
    const supportsSetRest = step.kind === "training" && (workoutDraft.sport === "strength" || workoutDraft.sport === "hyrox" && isHyroxFunctionalStation(step.name));
    return <article className={`plan-workout-step${isActive ? " is-active" : " is-collapsed"}${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`} data-step-kind={step.kind} key={`${index}-${step.name}`} onDragOver={(event) => allowWorkoutDrop(event, dragItem)} onDrop={(event) => finishWorkoutDrop(event, dragItem)}>
      <header className="plan-workout-step-title"><WorkoutDragHandle onDragStart={(event) => beginWorkoutDrag(event, dragItem)} onDragEnd={endWorkoutDrag} /><span className="plan-workout-step-index">{String(index + 1).padStart(2, "0")}</span><button className="plan-workout-step-toggle" type="button" aria-expanded={isActive} onClick={() => setActiveWorkoutStep(isActive ? null : index)}><small>Step {index + 1}</small><strong>{displayStepName(step)}</strong><em>{stepSummary(step)}</em></button><div className="plan-workout-step-header-actions">{video && <button type="button" aria-label={`${isVideoOpen ? "Hide" : "Show"} ${displayStepName(step)} technique video`} title={`${isVideoOpen ? "Hide" : "Show"} technique video`} aria-pressed={isVideoOpen} onClick={() => setActiveExerciseVideoStep(isVideoOpen ? null : index)}><WorkoutIcon name="video" size={15} /></button>}<button type="button" aria-label="Duplicate step" title="Duplicate step" onClick={() => duplicateStep(index)}><WorkoutIcon name="copy" size={15} /></button><button type="button" aria-label="Delete step" title="Delete step" disabled={workoutDraft.steps.length === 1} onClick={() => setWorkoutDraft({ ...workoutDraft, steps: workoutDraft.steps.filter((_, position) => position !== index) })}><WorkoutIcon name="trash" size={15} /></button></div></header>
      {video && isVideoOpen && <aside className="plan-workout-exercise-video" aria-label={`${displayStepName(step)} technique preview`}><video src={video} controls loop muted playsInline preload="metadata" /></aside>}
       {isActive && <div className="plan-workout-step-fields">
         {isStrengthMovement && <label><span>Movement</span><ExerciseCombobox value={step.name} options={exerciseOptions} loading={exerciseOptionsLoading} onChange={(selectedName, option) => updateStep(index, { name: resolveExerciseName(selectedName, selectedName), exercise_code: selectedName, exercise_id: option?.id ?? null })} /></label>}
         {hasCustomStepTitle && <label><span>Step title</span><input value={step.name} maxLength={80} placeholder={friendlyStepName(step.kind)} onChange={(event) => updateStep(index, { name: event.target.value })} /></label>}
         <label><span>Type</span><SingleSelect ariaLabel="Step type" value={step.kind} onChange={(value) => { const kind = value as WorkoutStepForm["kind"]; updateStep(index, { kind, target: targetsFor(workoutDraft.sport, kind, step.exercise_code ?? step.name)[0] }); }} options={[{ value: "warmup", label: "Warm-up" }, { value: "training", label: "Training" }, { value: "rest", label: "Rest" }, { value: "cooldown", label: "Cool-down" }]} /></label>
         <label><span>Finish target</span><SingleSelect ariaLabel="Finish target" value={step.target} onChange={(value) => { const nextTarget = value as WorkoutTarget; const nextValue = nextTarget === "distance" ? (step.target === "distance" ? step.value : 1000) : nextTarget === "time" ? (step.target === "time" ? step.value : 600) : step.value; updateStep(index, { target: nextTarget, value: nextValue }); }} options={targets.map((target) => ({ value: target, label: targetLabel(target) }))} /></label>
         {step.target !== "open" && <label><span>{targetValueLabel(step.target)}</span>{step.target === "time" ? <DurationInput key={step.value} seconds={step.value} onChange={(value) => updateStep(index, { value })} /> : step.target === "distance" ? <NumberStepper ariaLabel={targetValueLabel(step.target)} min={0.001} step={0.1} value={Number((step.value / 1000).toFixed(3))} onChange={(value) => updateStep(index, { value: Math.round((Number(value) || 0) * 1000) })} /> : <NumberStepper ariaLabel={targetValueLabel(step.target)} min={0} value={step.value} onChange={(value) => updateStep(index, { value: Number(value) || 0 })} />}</label>}
         {isStrengthMovement && <label><span>Sets</span><NumberStepper ariaLabel="Sets" min={1} max={99} value={step.sets} onChange={(value) => updateStep(index, { sets: Math.max(1, Number(value) || 1) })} /></label>}{supportsSetRest && <label className="plan-workout-rest-between-sets"><span>Rest between sets (sec)</span><NumberStepper ariaLabel="Rest between sets in seconds" min={0} max={3600} value={step.rest_seconds} onChange={(value) => updateStep(index, { rest_seconds: Math.max(0, Number(value) || 0) })} /></label>}
         <label><span>Intensity</span><SingleSelect ariaLabel="Intensity" value={step.intensity} onChange={(value) => { const intensity = value as WorkoutIntensity; updateStep(index, { intensity, intensity_basis: "max_hr", intensity_zone: null, ...initialIntensityValues(intensity) }); }} options={INTENSITY_OPTIONS.filter((option) => intensitiesFor(workoutDraft.sport, step.kind).includes(option.value))} /></label>
        {step.intensity === "heart_rate_percent" ? <label><span>Heart-rate basis</span><SingleSelect ariaLabel="Heart-rate basis" value={step.intensity_basis} onChange={(value) => updateStep(index, { intensity_basis: value as WorkoutIntensityBasis, intensity_zone: null, ...initialIntensityValues(step.intensity) })} options={[{ value: "max_hr", label: "% Max Heart Rate" }, { value: "reserve", label: "% Heart Rate Reserve" }, { value: "lthr", label: "% Threshold HR" }]} /></label> : null}
        {step.intensity === "stroke" ? <label><span>Stroke</span><SingleSelect ariaLabel="Stroke" value={String(step.intensity_low ?? 1)} onChange={(value) => updateStep(index, { intensity_low: Number(value), intensity_high: null })} options={STROKE_OPTIONS} /></label> : null}
        {(() => {
          const zones = intensityZones(step.intensity, step.intensity_basis);
          return zones ? <label><span>Range</span><SingleSelect ariaLabel="Intensity range" value={String(step.intensity_zone ?? "custom")} onChange={(value) => { const zone = zones.find((item) => item.id === Number(value)); updateStep(index, zone ? { intensity_zone: zone.id, intensity_low: zone.low, intensity_high: zone.high } : { intensity_zone: null }); }} options={[{ value: "custom", label: "Custom range" }, ...zones.map((zone) => ({ value: String(zone.id), label: `${zone.label} (${zone.low}%–${zone.high}%)` }))]} /></label> : null;
        })()}
        {INTENSITY_RANGE[step.intensity] && step.intensity_zone === null ? (() => {
          const range = INTENSITY_RANGE[step.intensity]!;
          const isPace = step.intensity === "pace" || step.intensity === "effort_pace";
          return <><label><span>{range.low}</span>{isPace ? <DurationInput key={step.intensity_low} seconds={step.intensity_low ?? 0} ariaLabel={range.low} onChange={(value) => updateStep(index, { intensity_zone: null, intensity_low: value })} /> : <NumberStepper ariaLabel={range.low} min={range.min} max={range.max} step={range.step} value={step.intensity_low ?? ""} onChange={(value) => updateStep(index, { intensity_zone: null, intensity_low: value === "" ? null : Number(value) })} />}</label>{range.high ? <label><span>{range.high}</span>{isPace ? <DurationInput key={step.intensity_high} seconds={step.intensity_high ?? 0} ariaLabel={range.high} onChange={(value) => updateStep(index, { intensity_zone: null, intensity_high: value })} /> : <NumberStepper ariaLabel={range.high} min={range.min} max={range.max} step={range.step} value={step.intensity_high ?? ""} onChange={(value) => updateStep(index, { intensity_zone: null, intensity_high: value === "" ? null : Number(value) })} />}</label> : null}</>;
        })() : null}
      </div>}
    </article>;
  };
  const structuredRepeatGroups = new Set(workoutDraft?.steps.flatMap((step) => step.repeat_group === null ? [] : [step.repeat_group]) ?? []).size;
  const structuredTotals = (workoutDraft?.steps ?? []).reduce((totals, step) => {
    const multiplier = step.repeat_group === null ? 1 : step.repeat_count ?? 1;
    if (step.target === "time") totals.seconds += (step.value * Math.max(1, step.sets) + Math.max(0, step.sets - 1) * step.rest_seconds) * multiplier;
    if (step.target === "distance") totals.distance += step.value * multiplier;
    return totals;
  }, { seconds: 0, distance: 0 });
  const workoutDate = workoutDraft?.date ?? events.find((event) => event.uid === editingUid)?.start.slice(0, 10);
  const workoutDateLabel = workoutDate
    ? new Date(`${workoutDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";
  const selectWorkoutEditorMode = (mode: WorkoutEditorMode) => {
    if (workoutDraft && workoutEditorMode !== "library") {
      setWorkoutDraftCache((cache) => ({ ...cache, [workoutEditorMode]: workoutDraft }));
    }
    setWorkoutEditorMode(mode);
    if (mode === "structured") setWorkoutDraft(workoutDraftCache.structured ?? newStructuredWorkoutDraft(selectedDate));
    if (mode === "structured") setActiveWorkoutStep(0);
    if (mode === "library" && libraryWorkouts.length === 0 && !isLoadingLibrary) void loadLibraryWorkouts();
  };
  const filteredLibraryWorkouts = libraryWorkouts.filter((workout) => workout.name.toLowerCase().includes(libraryFilter.trim().toLowerCase()));
  const selectedLibraryWorkout = libraryWorkouts.find((workout) => workout.id === selectedLibraryWorkoutId);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="page-header">
          <PageTitle>Training Calendar</PageTitle>
          <div className="plan-calendar-controls">
            <button
              className={`plan-calendar-source-switch is-${source}`}
              type="button"
              role="switch"
              aria-checked={source === "coros"}
              aria-label={`Calendar source: ${source === "coros" ? "COROS Calendar" : "iCal"}`}
              onClick={() => setSource(source === "ical" ? "coros" : "ical")}
            >
              <span>COROS</span>
              <span>iCal</span>
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={returnToToday}>Today</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">‹</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => moveMonth(1)} aria-label="Next month">›</button>
          </div>
        </header>

        <div className="page-body">
          <div className="plan-calendar-heading">
            <h1>{monthLabel}</h1>
          </div>

          {error && <div className="plan-calendar-message error">Calendar unavailable: {error}</div>}
          {calendarMoveNotice && <div className={`plan-calendar-move-toast is-${calendarMoveNotice.kind}`} role={calendarMoveNotice.kind === "error" ? "alert" : "status"} aria-live={calendarMoveNotice.kind === "error" ? "assertive" : "polite"}><span />{calendarMoveNotice.message}</div>}
          {isLoading && (
            <div className="plan-calendar-layout plan-calendar-skeleton" aria-label="Loading calendar" aria-busy="true">
              <section className="plan-calendar-grid">
                <div className="plan-calendar-weekdays">
                  {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="plan-calendar-days">
                  {days.map((date) => (
                    <div className="plan-calendar-day" key={localDateKey(date)}>
                      <span className="skeleton plan-calendar-skeleton-date" />
                      <span className="skeleton plan-calendar-skeleton-entry" />
                    </div>
                  ))}
                </div>
              </section>
              <aside className="plan-day-detail hover-card">
                <div className="skeleton plan-calendar-skeleton-label" />
                <div className="skeleton plan-calendar-skeleton-title" />
                <div className="skeleton plan-calendar-skeleton-line" />
              </aside>
            </div>
          )}

          {!isLoading && !error && (
            <div className="plan-calendar-layout">
              <section className="plan-calendar-grid" aria-label={`${monthLabel} training calendar`}>
                <div className="plan-calendar-weekdays">
                  {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="plan-calendar-days">
                  {days.map((date) => {
                    const dateKey = localDateKey(date);
                    const plans = eventsByDate[dateKey] ?? [];
                    const inMonth = date.getMonth() === anchor.getMonth();
                    const isPast = dateKey < todayKey;
                    const isToday = dateKey === todayKey;
                    const isSelected = dateKey === selectedDate;
                    return (
                      <div
                        key={dateKey}
                        role="button"
                        tabIndex={0}
                        className={`plan-calendar-day${inMonth ? "" : " is-outside"}${isPast ? " is-past" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}${calendarDropDate === dateKey ? " is-drop-target" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelectedDate(dateKey)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedDate(dateKey);
                          }
                        }}
                        onDragOver={(event) => allowCalendarWorkoutDrop(event, dateKey)}
                        onDragLeave={() => calendarDropDate === dateKey && setCalendarDropDate(null)}
                        onDrop={(event) => dropCalendarWorkout(event, dateKey)}
                      >
                        <div className="plan-calendar-day-header">
                          <span className="plan-calendar-date">{date.getDate()}</span>
                          {source === "coros" && !isPast && (
                            <button
                              className="plan-calendar-add-btn"
                              type="button"
                              title="Add workout for this day"
                              aria-label={`Add workout for ${dateKey}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openNewWorkout(dateKey);
                              }}
                            >
                              +
                            </button>
                          )}
                        </div>
                        <span className="plan-calendar-entries">
                          {plans.slice(0, 2).map((event) => {
                            const sportVisual = getSportVisual(event.event_type, event.summary);
                            const canDragWorkout = source === "coros" && event.start.slice(0, 10) >= todayKey;
                            return (
                              <span
                                className={`plan-calendar-entry planned${canDragWorkout ? " is-draggable" : ""}${draggedCalendarWorkout?.uid === event.uid ? " is-dragging" : ""}`}
                                key={event.uid}
                                draggable={canDragWorkout}
                                title={canDragWorkout ? "Drag to move workout" : undefined}
                                onDragStart={(dragEvent) => canDragWorkout && beginCalendarWorkoutDrag(dragEvent, event)}
                                onDragEnd={() => { setDraggedCalendarWorkout(null); setCalendarDropDate(null); }}
                                style={{ background: `radial-gradient(circle at 0 0, ${sportVisual.background}, transparent 90%), var(--color-surface-secondary)`, borderColor: sportVisual.background }}
                              >
                                <small style={{ color: sportVisual.color }}>{formatTime(event.start, event.is_all_day)}</small>
                                <strong>{event.summary}</strong>
                              </span>
                            );
                          })}
                          {plans.length > 2 && <span className="plan-calendar-more">+{plans.length - 2} more</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <aside className="plan-day-detail">
                <span className="plan-day-detail-label">Selected day</span>
                <h3>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</h3>
                {selectedPlans.length === 0 && <p className="plan-day-empty">No planned workout.</p>}
                {selectedPlans.map((event) => (
                  <div className="plan-day-item planned" key={event.uid}>
                    <span>{formatTime(event.start, event.is_all_day)}</span>
                    <strong>{event.summary}</strong>
                    {event.location && (
                      <div className="plan-location">
                        <small>{event.location}</small>
                        <iframe title={`Map for ${event.location}`} src={mapEmbedUrl(event.location)} loading="lazy" referrerPolicy="no-referrer" />
                      </div>
                    )}
                    {event.description && <div className="plan-workout-note"><span>Workout notes</span><p>{formatEventNote(event)}</p></div>}
                    {event.workout_steps?.length ? <WorkoutStructure steps={event.workout_steps} /> : null}
                    {source === "coros" && (
                      <div className="plan-workout-actions">
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => void openEditWorkout(event.uid)}>Edit</button>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setDeleteTarget({ kind: "calendar", uid: event.uid, name: event.summary })}>Delete</button>
                      </div>
                    )}
                  </div>
                ))}
              </aside>
            </div>
          )}
          {(workoutDraft || isLoadingWorkoutEditor) && (
            <div className="plan-workout-editor-backdrop" role="dialog" aria-modal="true" aria-label="COROS workout editor">
              <section className={`plan-workout-editor is-${workoutEditorMode}`}>
                <header className="plan-workout-editor-header">
                  <div><p><WorkoutIcon name="calendar" size={13} />{workoutDateLabel}</p><h2>{editingUid ? "Edit workout" : "Add workout"}</h2></div>
                  <button className="plan-workout-editor-close" type="button" aria-label="Close workout editor" onClick={closeWorkoutEditor}><WorkoutIcon name="close" /></button>
                </header>
                {!editingUid && (
                  <div className="plan-workout-editor-tabs" role="tablist" aria-label="Workout creation method">
                    {(["library", "structured"] as WorkoutEditorMode[]).map((mode) => <button key={mode} type="button" role="tab" aria-selected={workoutEditorMode === mode} className={workoutEditorMode === mode ? "is-active" : ""} onClick={() => selectWorkoutEditorMode(mode)}><WorkoutIcon name={mode === "library" ? "book" : "list"} size={14} />{mode === "library" ? "From library" : "Create workout"}</button>)}
                  </div>
                )}
                {workoutError && <p className="plan-workout-error" role="alert">Could not schedule workout: {workoutError}</p>}
                {workoutEditorMode === "library" && (
                  <section className="plan-workout-library-pane">
                    <label className="plan-workout-field plan-workout-library-search"><span className="sr-only">Search workouts</span><input value={libraryFilter} placeholder="Search workouts" onChange={(event) => setLibraryFilter(event.target.value)} /></label>
                    {isLoadingLibrary ? (
                      <p className="plan-workout-library-empty">Loading library…</p>
                    ) : filteredLibraryWorkouts.length === 0 ? (
                      <p className="plan-workout-library-empty">No workouts in your library.</p>
                    ) : (
                      <div className="plan-workout-library-list" aria-label="Saved COROS workouts">
                        {filteredLibraryWorkouts.map((workout) => {
                          const sportVisual = getSportVisual(workout.sport);
                          const isSelected = selectedLibraryWorkoutId === workout.id;
                          return (
                            <div className={`plan-workout-library-item${isSelected ? " is-selected" : ""}`} key={workout.id}>
                              <button type="button" className="plan-workout-library-select" onClick={() => setSelectedLibraryWorkoutId(workout.id)}>
                                <div className="plan-workout-library-icon" style={{ background: sportVisual.background, color: sportVisual.color }}>
                                  <SportIcon sport={workout.sport} size={20} color={sportVisual.color} />
                                </div>
                                <div className="plan-workout-library-info">
                                  <strong className="plan-workout-library-name">{workout.name}</strong>
                                  <span className="plan-workout-library-meta">
                                    {SPORT_OPTIONS.find((option) => option.value === workout.sport)?.label}
                                    {workout.step_count ? ` · ${workout.step_count} steps` : ""}
                                    {workout.total_distance
                                      ? ` · ${(workout.total_distance / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
                                      : workout.total_time ? ` · ${formatDuration(workout.total_time)}` : ""}
                                  </span>
                                  {workout.step_kinds && workout.step_kinds.length > 0 && (
                                    <div className="plan-workout-structure-bar" aria-hidden="true" title="Workout structure">
                                      {workout.step_kinds.map((kind, idx) => (
                                        <span key={idx} className="plan-workout-structure-segment" data-kind={kind} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </button>
                              <button
                                type="button"
                                className="plan-workout-library-delete"
                                aria-label={`Delete ${workout.name}`}
                                title={`Delete ${workout.name}`}
                                onClick={() => setDeleteTarget({ kind: "library", workout })}
                                disabled={deletingLibraryWorkoutId === workout.id}
                              >
                                {deletingLibraryWorkoutId === workout.id ? "…" : <WorkoutIcon name="trash" size={15} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <footer className="plan-workout-editor-footer">
                      <p className="plan-workout-library-selection" aria-live="polite">
                        {selectedLibraryWorkout ? <><strong>{selectedLibraryWorkout.name}</strong><small>{`Ready to customize for ${workoutDateLabel}.`}</small></> : "Select a workout to continue."}
                      </p>
                      <button className="btn btn-primary" type="button" disabled={!selectedLibraryWorkoutId || isSavingWorkout} onClick={() => selectedLibraryWorkoutId && void openLibraryWorkout(selectedLibraryWorkoutId)}>{isSavingWorkout ? "Opening…" : "Customize workout"}</button>
                    </footer>
                  </section>
                )}
                {workoutEditorMode === "structured" && workoutDraft && (isLoadingWorkoutEditor ? (
                  <div className="plan-workout-editor-skeleton" aria-busy="true" aria-live="polite"><span className="sr-only">Loading workout editor</span><div><i className="skeleton plan-workout-skeleton-orb" /><span><strong>Loading workout</strong><small>Preparing the editor…</small></span></div></div>
                ) : workoutLoadError ? <p className="plan-workout-error" role="alert">Could not load workout: {workoutLoadError}</p> : (
                  <div className="plan-workout-structured">
                    <aside className="plan-workout-builder-settings" aria-label="Workout settings">
                      <div className="plan-workout-pane-heading"><h3>Workout settings</h3><p>Set the basics for your workout.</p></div>
                       <div className="plan-workout-sport-field"><span>Sport</span><div className="plan-workout-sport-grid" role="group" aria-label="Workout sport">{SPORT_OPTIONS.map((option) => <button key={option.value} type="button" title={option.label} aria-label={option.label} aria-pressed={workoutDraft.sport === option.value} className={workoutDraft.sport === option.value ? "is-active" : ""} onClick={() => setWorkoutDraft({ ...workoutDraft, sport: option.value, steps: workoutDraft.steps.map((step) => { const intensity = intensitiesFor(option.value, step.kind).includes(step.intensity) ? step.intensity : option.value === "indoor_climb" || option.value === "bouldering" ? "grade" : "none"; const strengthTraining = option.value === "strength" && step.kind === "training"; return { ...step, target: strengthTraining && (step.target === "time" || step.target === "distance") ? "reps" : step.target, value: strengthTraining && (step.target === "time" || step.target === "distance") ? 10 : step.value, sets: strengthTraining ? Math.max(1, step.sets ?? 3) : step.sets, intensity, ...initialIntensityValues(intensity) }; }) })}><SportIcon sport={option.value} size={22} /></button>)}</div></div>
                      <label className="plan-workout-field"><span>Workout name <small>Optional</small></span><input value={workoutDraft.name} placeholder={workoutDraft.sport === "strength" ? "Full-body strength" : workoutDraft.sport === "swim" ? "Pool endurance" : "6 x 800 m"} onChange={(event) => setWorkoutDraft({ ...workoutDraft, name: event.target.value })} /></label>
                      <label className="plan-workout-field plan-workout-builder-description"><span>Description <small>{workoutDraft.description.length} / 200</small></span><textarea maxLength={200} rows={4} value={workoutDraft.description} placeholder="Add coaching notes or the goal of this workout" onChange={(event) => setWorkoutDraft({ ...workoutDraft, description: event.target.value })} /></label>
                      <label className={`plan-workout-save-card${structuredSaveToLibrary ? " is-checked" : ""}`}><input type="checkbox" checked={structuredSaveToLibrary} onChange={(event) => setStructuredSaveToLibrary(event.target.checked)} /><WorkoutIcon name="save" size={18} /><span><strong>Save to library</strong><small>Keep a reusable copy after scheduling.</small></span></label>
                    </aside>
                    <section className="plan-workout-builder-canvas" aria-labelledby="plan-workout-steps-title">
                      <header className="plan-workout-builder-canvas-header"><div><h3 id="plan-workout-steps-title">Workout steps</h3><p>Repeat groups contain their own ordered sub-steps.</p></div><span>{workoutDraft.steps.length} {workoutDraft.steps.length === 1 ? "step" : "steps"}{structuredRepeatGroups ? `, ${structuredRepeatGroups} ${structuredRepeatGroups === 1 ? "repeat" : "repeats"}` : ""}</span></header>
                      <div className="plan-workout-steps">
                        {workoutDraft.steps.map((step, index) => {
                          if (step.repeat_group === null || step.repeat_group === undefined) return stepEditor(step, index);
                          if (workoutDraft.steps.findIndex((item) => item.repeat_group === step.repeat_group) !== index) return null;
                          const groupSteps = workoutDraft.steps.map((item, position) => ({ item, position })).filter(({ item }) => item.repeat_group === step.repeat_group);
                          const dragItem: WorkoutDragItem = { scope: "block", index };
                          const dragClass = draggedWorkoutItem?.scope === "block" && draggedWorkoutItem.index === index ? " is-dragging" : dropTargetWorkoutItem?.scope === "block" && dropTargetWorkoutItem.index === index ? " is-drop-target" : "";
                          return <section className={`plan-workout-repeat${dragClass}`} key={`repeat-${step.repeat_group}`} onDragOver={(event) => allowWorkoutDrop(event, dragItem)} onDrop={(event) => finishWorkoutDrop(event, dragItem)}><header><WorkoutDragHandle onDragStart={(event) => beginWorkoutDrag(event, dragItem)} onDragEnd={endWorkoutDrag} /><div><span>Repeat block</span><h3>Repeat {step.repeat_count ?? 1} times</h3></div><label>Times<NumberStepper ariaLabel="Repeat times" min={1} max={99} value={step.repeat_count ?? 1} onChange={(value) => updateRepeatBlock(step.repeat_group!, Math.max(1, Number(value) || 1))} /></label></header><div className="plan-workout-repeat-children">{groupSteps.map(({ item, position }) => stepEditor(item, position, true))}</div></section>;
                        })}
                        <div className="plan-workout-add-bar" role="group" aria-label="Add a workout block"><span><WorkoutIcon name="plus" size={12} />Add block</span><div>{(["warmup", "training", "rest", "cooldown"] as WorkoutStepForm["kind"][]).map((kind) => <button key={kind} type="button" data-kind={kind} onClick={() => addWorkoutStep(kind)}>{friendlyStepName(kind)}</button>)}<button type="button" data-kind="repeat" onClick={addRepeatBlock}>Repeat</button></div></div>
                      </div>
                    </section>
                  </div>
                ))}
                {workoutEditorMode === "structured" && workoutDraft && !isLoadingWorkoutEditor && !workoutLoadError && <footer className="plan-workout-editor-footer"><p><span className="plan-workout-builder-totals"><span>{workoutDraft.steps.length} {workoutDraft.steps.length === 1 ? "step" : "steps"}{structuredRepeatGroups ? `, ${structuredRepeatGroups} ${structuredRepeatGroups === 1 ? "repeat" : "repeats"}` : ""}</span>{structuredTotals.seconds > 0 && <span>≈{formatDuration(structuredTotals.seconds)}</span>}{structuredTotals.distance > 0 && <span>{formatKilometers(structuredTotals.distance)}</span>}<span>{SPORT_OPTIONS.find((option) => option.value === workoutDraft.sport)?.label}</span></span></p><button className="btn btn-primary" type="button" onClick={() => void saveWorkout()} disabled={isSavingWorkout}><WorkoutIcon name="calendar" />{isSavingWorkout ? "Saving…" : editingUid ? "Confirm edit" : "Schedule workout"}</button></footer>}
              </section>
            </div>
          )}
          {deleteTarget && <dialog open className="ai-delete-dialog" aria-labelledby="plan-delete-title">
            <div className="ai-delete-dialog-content">
              <span className="ai-delete-dialog-label">Delete workout</span>
              <h2 id="plan-delete-title">Delete {deleteTarget.kind === "library" ? "saved workout" : "scheduled workout"}?</h2>
              <p><strong>{deleteTarget.kind === "library" ? deleteTarget.workout.name : deleteTarget.name}</strong> will be removed from COROS.</p>
              <div className="ai-delete-dialog-actions">
                <button className="btn btn-secondary" type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn ai-delete-dialog-confirm" type="button" onClick={confirmDelete}>Delete</button>
              </div>
            </div>
          </dialog>}
        </div>
      </main>
    </div>
  );
}
