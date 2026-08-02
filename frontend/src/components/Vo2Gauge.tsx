"use client";

interface Vo2GaugeProps {
  score: number | null;
  minScore?: number;
  maxScore?: number;
  title?: string;
  subtitle?: string;
  runningFitness?: number | null;
  baseline?: number | null;
  updatedDate?: string;
  trendText?: string;
}

export default function Vo2Gauge({
  score,
  minScore = 30,
  maxScore = 75,
  title = "VO2 MAX",
  subtitle = "Running engine",
  runningFitness,
  baseline,
  updatedDate,
  trendText,
}: Vo2GaugeProps) {
  const hasScore = score !== null;
  const gaugeScore = score ?? minScore;
  const pct = Math.min(Math.max((gaugeScore - minScore) / (maxScore - minScore), 0), 1);
  const displayScore = score === null ? "--" : score % 1 !== 0 ? score.toFixed(1) : score;

  return (
    <article className="hover-card performance-instrument vo2-instrument">
      <header className="instrument-header">
        <div>
          <span className="instrument-eyebrow">{title}</span>
          <h4>{subtitle}</h4>
        </div>
        <svg className="instrument-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      </header>

      <div className="vo2-readout-grid">
        <div className="instrument-primary-reading">
          <span>Current VO2 max</span>
          <strong>{displayScore}</strong>
        </div>
        <div className="vo2-trend-reading">
          <span>30-day signal</span>
          <strong>{trendText ?? "No baseline"}</strong>
        </div>
      </div>

      <section className="vo2-scale-section" aria-label={`VO2 max range ${minScore} to ${maxScore}, current value ${displayScore}`}>
        <div className="vo2-scale" aria-hidden="true">
          <span className="vo2-scale-fill" style={{ width: `${pct * 100}%` }} />
          {hasScore && <span className="vo2-scale-marker" style={{ left: `${pct * 100}%` }} />}
        </div>
      </section>

      <footer className="instrument-footer-grid">
        <div><span>Run fitness</span><strong>{runningFitness?.toFixed(1) ?? "--"}</strong></div>
        <div><span>30d average</span><strong>{baseline?.toFixed(1) ?? "--"}</strong></div>
        <div><span>Updated</span><strong>{updatedDate ?? "--"}</strong></div>
      </footer>
    </article>
  );
}
