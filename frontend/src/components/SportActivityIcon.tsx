import type { ReactNode } from "react";

export type SportVisual = { label: string; background: string; color: string };

// Icons8 CDN icon URLs — unified mapping for all sport types
export const SPORT_ICON_URLS: Record<string, string> = {
  run: "https://img.icons8.com/liquid-glass/96/running.png",
  treadmill: "https://img.icons8.com/?size=100&id=LOSlMRj2tj2O&format=png&color=000000",
  trail_run: "https://img.icons8.com/liquid-glass/96/trekking.png",
  ride: "https://img.icons8.com/liquid-glass/96/bicycle.png",
  swim: "https://img.icons8.com/liquid-glass/96/swimming.png",
  hike: "https://img.icons8.com/liquid-glass/96/mountain.png",
  walk: "https://img.icons8.com/liquid-glass/96/walking.png",
  strength: "https://img.icons8.com/liquid-glass/96/dumbbell.png",
  hyrox: "https://img.icons8.com/?size=100&id=aZCcxa9TqPy7&format=png&color=000000",
  cardio: "https://img.icons8.com/?size=100&id=aZCcxa9TqPy7&format=png&color=000000",
  multisport: "https://img.icons8.com/?size=100&id=aZCcxa9TqPy7&format=png&color=000000",
  yoga: "https://img.icons8.com/liquid-glass/96/yoga.png",
  badminton: "https://img.icons8.com/?size=100&id=t7ONehkDkZMA&format=png&color=000000",
  other: "https://img.icons8.com/liquid-glass/96/activity.png",
};

const SPORT_VISUALS: Record<string, SportVisual> = {
  run: { label: "Run", background: "rgba(33, 230, 165, 0.14)", color: "var(--color-accent-primary)" },
  treadmill: { label: "Treadmill", background: "rgba(33, 230, 165, 0.14)", color: "var(--color-accent-primary)" },
  trail_run: { label: "Trail Run", background: "rgba(120, 200, 80, 0.14)", color: "#6dbf43" },
  ride: { label: "Ride", background: "rgba(240, 211, 72, 0.14)", color: "var(--color-status-moderate)" },
  swim: { label: "Swim", background: "rgba(45, 155, 240, 0.14)", color: "var(--color-accent-exertion)" },
  hike: { label: "Hike", background: "rgba(165, 175, 180, 0.14)", color: "var(--color-text-secondary)" },
  walk: { label: "Walk", background: "rgba(165, 175, 180, 0.14)", color: "var(--color-text-secondary)" },
  strength: { label: "Strength", background: "rgba(255, 77, 98, 0.14)", color: "var(--color-status-critical)" },
  hyrox: { label: "Hyrox / Hybrid", background: "rgba(147, 100, 240, 0.14)", color: "#9364f0" },
  cardio: { label: "Cardio", background: "rgba(240, 140, 60, 0.14)", color: "#f08c3c" },
  yoga: { label: "Yoga", background: "rgba(240, 150, 200, 0.14)", color: "#e06cba" },
  badminton: { label: "Badminton", background: "rgba(165, 175, 180, 0.14)", color: "var(--color-text-secondary)" },
  multisport: { label: "Multisport", background: "rgba(147, 100, 240, 0.14)", color: "#9364f0" },
  other: { label: "Activity", background: "rgba(165, 175, 180, 0.14)", color: "var(--color-text-secondary)" },
};

/**
 * Resolves a normalized sport key from activity sport string, title, or subsport code.
 */
export function resolveSportKey(sport?: string, title?: string, subsport?: string): string {
  const s = (sport || "").toLowerCase();
  const t = (title || "").toLowerCase();
  const sub = (subsport || "").toString();

  // Keyword / Subsport detections
  if (t.includes("treadmill") || t.includes("indoor run") || sub === "101") return "treadmill";
  if (t.includes("hyrox") || t.includes("hybrid") || sub === "1200") return "hyrox";
  if (t.includes("yoga") || sub === "904" || sub === "905") return "yoga";
  if (t.includes("badminton") || sub === "1000") return "badminton";
  if (t.includes("cardio") || t.includes("skierg") || sub === "400" || sub === "701") return "cardio";
  if (t.includes("hike") || sub === "104") return "hike";
  if (t.includes("trail") || sub === "102") return "trail_run";

  // Enum sport mappings
  if (s === "run" || s === "running") return "run";
  if (s === "treadmill") return "treadmill";
  if (s === "trail_run") return "trail_run";
  if (s === "ride" || s === "cycling" || s === "bike") return "ride";
  if (s === "swim" || s === "swimming") return "swim";
  if (s === "walk" || s === "walking") return "walk";
  if (s === "hike" || s === "hiking") return "hike";
  if (s === "strength" || s === "gym") return "strength";
  if (s === "multisport") return "hyrox";

  return s || "other";
}

export function getSportVisual(sport: string, title?: string, subsport?: string): SportVisual {
  const key = resolveSportKey(sport, title, subsport);
  return SPORT_VISUALS[key] || {
    label: (title || sport || "Activity").replace(/_/g, " "),
    background: "rgba(165, 175, 180, 0.14)",
    color: "var(--color-text-secondary)",
  };
}

export function SportIcon({
  sport,
  title,
  subsport,
  size = 24,
  color,
}: {
  sport: string;
  title?: string;
  subsport?: string;
  size?: number;
  color?: string;
}): ReactNode {
  const visual = getSportVisual(sport, title, subsport);
  const iconColor = color || visual.color;
  const key = resolveSportKey(sport, title, subsport);
  const iconUrl = SPORT_ICON_URLS[key] ?? SPORT_ICON_URLS.other;

  return (
    <span
      className="sport-activity-icon"
      aria-label={sport || title || "sport icon"}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: "inline-block",
        verticalAlign: "middle",
        backgroundColor: iconColor,
        WebkitMaskImage: `url("${iconUrl}")`,
        maskImage: `url("${iconUrl}")`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        flexShrink: 0,
      }}
    />
  );
}
