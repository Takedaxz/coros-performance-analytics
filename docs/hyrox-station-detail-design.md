# Hyrox Station Detail Design

## Understanding

- Show COROS-style detail for each of the 16 Hyrox segments.
- Runs need heart-rate and pace charts.
- Functional stations need heart-rate and cadence or stroke-rate charts.
- Expanded cards need event time, load, max and average heart rate, and relevant pace or cadence metrics.
- Only one row expands at a time.
- Historical activities without detailed samples keep their existing summary view.
- The feature is for the existing single-user COROS analytics application.

## Assumptions

- COROS Hybrid Fitness continues to use subsport `1200`.
- `frequencyList` timestamps and lap start timestamps use centiseconds.
- Run `speed` values represent seconds per kilometre.
- Station `cadence` represents the rate series displayed by COROS.
- Mobile-like information and interaction are required; pixel-perfect COROS styling is not.
- Detailed records are persisted during Sync so opening a row does not call COROS.

## Data Flow

1. Fetch the existing COROS activity-detail response during Hybrid sync.
2. Parse logical segments and discard mode `16` helper rows.
3. Convert `frequencyList` into the existing `ActivityRecord` model:
   - `heart` to `heart_rate_bpm`
   - `cadence` to `cadence`
   - run `speed` to `speed_mps`
   - `distance` to `distance_m`
   - COROS timestamps to workout-relative `elapsed_s`
4. Replace only the Hybrid activity's FIT-derived records after successful parsing.
5. Continue serving samples through the existing `/api/activities/{id}/records` endpoint.
6. Filter samples by lap boundaries in the activity-detail page.

## UI

- The summary table remains the default view.
- Clicking a Hyrox row expands its detail directly below that row.
- Clicking the open row collapses it; clicking another row switches the expansion.
- Run cards display heart rate and pace.
- Station cards display heart rate and cadence.
- Missing series fall back to available summary metrics without hiding the row.

## Failure Handling

- Do not replace existing records when the COROS detail response has no usable samples.
- Preserve the existing summary laps if detailed parsing fails.
- Log the activity identifier and parsing operation without credentials or raw sensitive payloads.
- A failed detail fetch does not fail the rest of the account Sync.

## Verification

- Parser check for timestamp, pace, cadence, heart rate, distance, and helper-row removal.
- Sync check that detailed COROS records replace the Hybrid FIT-only records.
- API check for populated run speed and station cadence.
- Browser check for exactly 16 rows and expandable Run and Ski Erg cards.
- Confirm non-Hyrox activity rendering is unchanged.

## Decision Log

1. Reuse `ActivityRecord`; rejected a new station-series table as unnecessary.
2. Persist during Sync; rejected live fetch-on-expand because it is slower and less reliable.
3. Replace FIT-only Hybrid records only after successful parsing.
4. Reuse the existing Recharts dependency.
5. Allow one expanded row at a time to keep the page compact.
6. Reproduce COROS information and behavior without cloning its visual design pixel-for-pixel.
