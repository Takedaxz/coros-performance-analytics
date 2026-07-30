# COROS Workout Step Labels

## Goal

Use COROS workout-step metadata as the only source for Warm-up, Training, Rest,
and Cool-down labels. Do not infer rest from pace, distance, or duration.

## Data Contract

COROS Team API activity details expose `exerciseType` on structured lap items:

- `1`: Warm-up
- `2`: Training
- `3`: Cool-down
- `4`: Rest

Raw FIT lap messages do not reliably contain these labels and remain the source
for telemetry only.

## Data Flow

1. When an unlabeled Run or Trail Run is opened, fetch its existing COROS Team
   API detail payload.
2. Convert and persist the detailed laps using the COROS workout-step labels.
3. Reuse the stored labels on subsequent requests.
4. If detail retrieval fails, preserve the existing unlabeled laps.

## Breakdown Grouping

- Group only consecutive laps with the same COROS label.
- Show one summary row per group with aggregated metrics.
- Expanding a group reuses the existing segment graph and shows every original
  lap with its original number.
- Do not group unlabeled laps or change Hyrox, Triathlon, or Swim breakdowns.
- Perform grouping in the frontend without changing stored activity data.

## Decision Log

- COROS labels are authoritative.
- The pace-and-duration recovery heuristic is removed.
- FIT parsing preserves a missing trigger as `null`, not the string `"None"`.
- No schema migration or new dependency is required.
- Consecutive phase grouping was selected over backend aggregation to preserve
  the existing API and raw lap contract.
- Validation covers label mapping, the activity API, and the rendered Stride
  and Long Run breakdowns.
