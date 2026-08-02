interface SleepCardProps {
  dateStr: string;
  score?: number;
  statusText?: string;
  durationSeconds: number;
  deepSeconds?: number;
  remSeconds?: number;
  lightSeconds?: number;
  awakeSeconds?: number;
  awakeCount?: number;
  napSeconds?: number;
}

type SleepStage = {
  label: string;
  seconds: number;
  percentage: number;
  color: string;
};

function formatHoursMins(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SleepCard({
  dateStr,
  score,
  statusText,
  durationSeconds,
  deepSeconds = 0,
  remSeconds = 0,
  lightSeconds = 0,
  awakeSeconds = 0,
  awakeCount = 1,
  napSeconds = 0,
}: SleepCardProps) {
  const scoreStatus = statusText ?? (score == null
    ? "WAITING"
    : score < 60
      ? "POOR"
      : score < 75
        ? "FAIR"
        : score < 90
          ? "GOOD"
          : "EXCELLENT");
  const total = durationSeconds || 1;
  const deepPct = Math.round((deepSeconds / total) * 100);
  const remPct = Math.round((remSeconds / total) * 100);
  const lightPct = Math.round((lightSeconds / total) * 100);
  const awakePct = Math.max(0, 100 - deepPct - remPct - lightPct);
  const stages: SleepStage[] = [
    { label: "Deep", seconds: deepSeconds, percentage: deepPct, color: "var(--color-accent-primary)" },
    { label: "Light", seconds: lightSeconds, percentage: lightPct, color: "var(--color-text-secondary)" },
    { label: "REM", seconds: remSeconds, percentage: remPct, color: "var(--color-accent-sleep)" },
    { label: "Awake", seconds: awakeSeconds, percentage: awakePct, color: "var(--color-text-disabled)" },
  ];
  return (
    <article className="hover-card performance-instrument sleep-instrument">
      <header className="instrument-header">
        <div>
          <span className="instrument-eyebrow">Sleep recovery</span>
          <h4>{dateStr}</h4>
        </div>
        <svg className="instrument-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </header>

      <div className="sleep-readout-grid">
        <div className="instrument-primary-reading">
          <span>Main sleep</span>
          <strong>{formatHoursMins(durationSeconds)}</strong>
        </div>
        <div className="sleep-score-reading">
          <span>Recovery score</span>
          <div>
            <strong>{score ?? "--"}</strong>
            <small>{scoreStatus}</small>
          </div>
        </div>
      </div>

      <section className="sleep-stage-section" aria-label="Sleep stage distribution">
        <div className="instrument-section-heading">
          <span>Sleep stage distribution</span>
        </div>
        <div className="sleep-stage-visual">
          <div className="sleep-stage-strip" role="group" aria-label="Sleep stages">
            {stages.map((stage) => (
              <button
                type="button"
                className="sleep-stage-segment"
                key={stage.label}
                aria-label={`${stage.label}: ${formatHoursMins(stage.seconds)} (${stage.percentage}%)`}
                style={{ flexGrow: Math.max(stage.percentage, 1) }}
              >
                <span className="sleep-stage-segment-fill" style={{ background: stage.color }} aria-hidden="true" />
                <span className="sleep-stage-popover" role="tooltip">
                  <strong>{stage.label}</strong>
                  <small>{`${formatHoursMins(stage.seconds)} · ${stage.percentage}%`}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="instrument-footer-grid">
        <div><span>Awake</span><strong>{formatHoursMins(awakeSeconds)}</strong></div>
        <div><span>Events</span><strong>{awakeCount} times</strong></div>
        <div><span>Naps</span><strong>{napSeconds > 0 ? formatHoursMins(napSeconds) : "—"}</strong></div>
      </footer>
    </article>
  );
}
