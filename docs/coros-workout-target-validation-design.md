# COROS Workout Target Validation

## Understanding Summary

- Prevent invalid workout targets from reaching COROS for every supported sport.
- Keep the backend as the authoritative validation boundary.
- Leave the editor UI unchanged.
- Preserve valid user-selected targets, values, and intensity settings.
- Keep stricter named-station rules for HYROX.

## Assumptions

- The editor's existing sport and step target choices describe the intended COROS support.
- Direct API clients and stale browser code may submit invalid targets.
- A `422` response is sufficient feedback for invalid requests.

## Final Design

- Add one backend target-policy mapping indexed by sport and step kind.
- Validate every workout step before constructing the COROS program payload.
- Return a clear `422` error without contacting COROS when a target is invalid.
- Retain the existing HYROX station override: seven named stations require a distance target and Wall Balls requires reps.

## Verification

- Focused unit tests for accepted and rejected targets for each sport.
- Existing HYROX mapping tests remain green.

## Decision Log

- **Backend-only validation:** selected over UI mirroring because the backend owns the COROS payload and protects all clients.
- **No database changes:** selected because the policy is static application behavior.
