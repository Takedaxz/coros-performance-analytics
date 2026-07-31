# AI Detailed Activity Context

## Understanding Summary

- AI Coach receives all activities in its existing 14-day training window.
- Every recorded lap, Hyrox station, workout phase, and non-duplicate distance split is included.
- Activity and segment pace, heart rate, power, cadence, calories, load, and elevation are preserved when available.
- Per-second telemetry is converted into six chronological windows plus whole-activity ranges and peaks.
- GPS is converted into route shape, approximate span, and start-to-end gap; exact coordinates are never sent.
- Existing health, sleep, fitness, goals, calendar, and conversation context remain unchanged.
- The detailed activity section targets about 8,000 tokens, keeping the complete request near 12,000 tokens.

## Assumptions

- This remains a single-athlete application with roughly 10–25 activities per 14-day window.
- Missing sensor fields are omitted instead of represented by repeated placeholders.
- All structured segment rows take priority over telemetry if the context budget is constrained.
- Context is built from the existing PostgreSQL data on each request; no cache, dependency, or schema migration is added.
- The external AI may receive training metrics, but never exact GPS coordinates.

## Final Design

`build_training_context` keeps the existing compact recent-activity table and appends one
`Detailed Activity Execution` section. It loads laps and records for all selected activities
in two batched queries.

Each activity uses a compact pipe-delimited format:

```text
[A1] 2026-07-29 15:15 | Hybrid Fitness (Hyrox)/other | dur=79:03 dist=4.03km kcal=599 hr=142/176 load=118
segments:
1 run | dur=1:21 dist=0.50km pace=2:43/km hr=146/152 cad=172
2 Ski Erg | dur=4:52 load=1000m hr=140/160 cad=154
telemetry: 0-13m hr=138/164 pace=...; ... | hr-range=... power-range=...
route: loop span=1.8x1.2km start-end=92m elev=3-14m
```

The metric legend appears once. Segment labels come from persisted COROS workout-step and
Hyrox identifiers. Six equal-duration telemetry windows retain progression without raw
per-second samples. Distance splits are included only when they add resolution beyond the
recorded lap rows.

The formatter has a 40,000-character detailed-section budget. Activity headers and segment
rows are mandatory. Route and telemetry lines are appended only while budget remains. If
structured rows alone exceed the budget, the formatter reports the omitted character count
instead of silently cutting a row.

## Reliability and Safety

- Empty laps or records produce valid summary-only activity blocks.
- Invalid or missing sensor values are ignored.
- Route geometry is calculated locally; coordinates never enter the prompt.
- The existing AI-provider error handling remains unchanged.
- No model is asked to infer missing raw measurements.

## Verification

- Pure formatter test for structured phase/Hyrox labels and compact metrics.
- Budget test proving output never cuts a structured row midway.
- Live context generation against the current 14-day database.
- Inspect character count, activity count, segment count, and absence of latitude/longitude.

## Decision Log

- **Scope:** All activities in the existing 14-day window.
- **Structure:** Deterministic context packer selected over stored summaries and model tool calls.
- **Telemetry:** Six aggregate windows selected over 51,143 raw records or fixed 30-second sampling.
- **Maps:** Privacy-safe route geometry selected over exact GPS coordinates.
- **Priority:** Activity and segment detail outrank telemetry when the budget is constrained.
- **Persistence:** No new table or cache; derive current context from existing records.
