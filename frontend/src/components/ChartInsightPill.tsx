import type { ReactNode } from "react";

interface ChartInsightPillProps {
  sevenDayAvg?: string | number | null;
  windowAvg?: string | number | null;
  unit?: string;
  className?: string;
  sevenDayTooltip?: string;
  windowTooltip?: string;
  tooltip?: string;
  extra?: ReactNode;
}

export function ChartInsightPill({
  sevenDayAvg,
  windowAvg,
  unit,
  className = "",
  sevenDayTooltip,
  windowTooltip,
  tooltip,
  extra,
}: ChartInsightPillProps) {
  if (sevenDayAvg == null && windowAvg == null && !extra) return null;
  const suffix = unit ? ` ${unit}` : "";

  return (
    <div className={`chart-insight-pills-group ${className}`.trim()}>
      {sevenDayAvg != null && (
        <span
          className="chart-insight-pill"
          title={sevenDayTooltip ?? (tooltip ? `7-day: ${tooltip}` : undefined)}
          aria-label={sevenDayTooltip ?? `7-day average: ${sevenDayAvg}${suffix}`}
        >
          <span className="pill-label">7D Avg</span>
          <strong>{sevenDayAvg}{suffix}</strong>
        </span>
      )}
      {windowAvg != null && (
        <span
          className="chart-insight-pill"
          title={windowTooltip ?? (tooltip ? `Window: ${tooltip}` : undefined)}
          aria-label={windowTooltip ?? `Window average: ${windowAvg}${suffix}`}
        >
          <span className="pill-label">Avg</span>
          <strong>{windowAvg}{suffix}</strong>
        </span>
      )}
      {extra}
    </div>
  );
}

export function computeSeriesStats(
  values: Array<number | null | undefined>,
  precision = 0,
): {
  sevenDayAvg: number | null;
  windowAvg: number | null;
} {
  const valid = values.filter((v): v is number => typeof v === "number" && !isNaN(v) && isFinite(v));
  if (valid.length === 0) return { sevenDayAvg: null, windowAvg: null };

  const factor = 10 ** precision;
  const rawWindow = valid.reduce((sum, v) => sum + v, 0) / valid.length;
  const windowAvg = Math.round(rawWindow * factor) / factor;

  const last7 = valid.slice(-7);
  const raw7d = last7.reduce((sum, v) => sum + v, 0) / last7.length;
  const sevenDayAvg = Math.round(raw7d * factor) / factor;

  return { sevenDayAvg, windowAvg };
}

export function formatCompactNumber(val: number): string {
  if (val >= 10000) {
    return `${(val / 1000).toFixed(1)}k`;
  }
  return Math.round(val).toLocaleString();
}

export function formatSleepHours(val: number): string {
  const totalMinutes = Math.round(val * 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}h ${mins}m`;
}
