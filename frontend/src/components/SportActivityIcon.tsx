import type { ReactNode } from "react";

export type SportVisual = { label: string; background: string; color: string };

export function getSportVisual(sport: string): SportVisual {
  const visuals: Record<string, SportVisual> = {
    run: { label: "Run", background: "rgba(33, 230, 165, 0.14)", color: "var(--color-accent-primary)" },
    trail_run: { label: "Trail Run", background: "rgba(33, 230, 165, 0.14)", color: "var(--color-accent-primary)" },
    ride: { label: "Ride", background: "rgba(240, 211, 72, 0.14)", color: "var(--color-status-moderate)" },
    swim: { label: "Swim", background: "rgba(45, 155, 240, 0.14)", color: "var(--color-accent-exertion)" },
    hike: { label: "Hike", background: "rgba(165, 175, 180, 0.14)", color: "var(--color-text-secondary)" },
    walk: { label: "Walk", background: "rgba(165, 175, 180, 0.14)", color: "var(--color-text-secondary)" },
    strength: { label: "Strength", background: "rgba(255, 77, 98, 0.14)", color: "var(--color-status-critical)" },
  };

  return visuals[sport] || {
    label: sport.replace(/_/g, " "),
    background: "rgba(165, 175, 180, 0.14)",
    color: "var(--color-text-secondary)",
  };
}

export function SportIcon({ sport }: { sport: string }): ReactNode {
  const svgProps = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (sport === "ride") return <svg {...svgProps}><circle cx="18.5" cy="17.5" r="3.5" /><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="15" cy="5" r="1" /><path d="M12 17.5V14l-3-3 4-3 2 3h4" /><path d="M5.5 17.5 9 7h3" /></svg>;
  if (sport === "swim") return <svg {...svgProps}><path d="M2 18c.6.4 1.2.8 2.5.8 2.5 0 2.5-1.6 5-1.6s2.5 1.6 5 1.6 2.5-1.6 5-1.6c1.3 0 1.9.4 2.5.8" /><path d="M2 22c.6.4 1.2.8 2.5.8 2.5 0 2.5-1.6 5-1.6s2.5 1.6 5 1.6 2.5-1.6 5-1.6c1.3 0 1.9.4 2.5.8" /><circle cx="7" cy="8" r="2" /><path d="m9 12 3-2 3 3" /></svg>;
  if (sport === "strength") return <svg {...svgProps}><path d="m6.5 6.5 11 11" /><path d="m21 21-1.5-1.5" /><path d="m3 3 1.5 1.5" /><path d="m18 22 4-4" /><path d="m2 6 4-4" /><path d="m3 10 7-7" /><path d="m14 21 7-7" /></svg>;
  if (sport === "hike" || sport === "trail_run") return <svg {...svgProps}><path d="m3 20 5-8 4 5 3-4 6 7" /><path d="m15 7 1.5 1.5L18 7" /><circle cx="12" cy="6" r="2" /></svg>;
  if (sport === "walk") return <svg {...svgProps}><circle cx="12" cy="4" r="2" /><path d="m10 22 1-8-4-3 2-4 3 2 3-2 2 4-4 3 1 8" /></svg>;
  if (sport === "run") return <svg {...svgProps}><circle cx="15" cy="5" r="2" /><path d="m13 9-2 4 3 2-2 5" /><path d="m13 9 3 3 4 1" /><path d="m11 13-4 4" /></svg>;
  return <svg {...svgProps}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
}
