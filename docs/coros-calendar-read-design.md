# COROS Calendar Read Design

## Understanding summary

- Training Plan keeps one monthly calendar UI.
- Users choose `iCal` or `COROS Calendar` in that page.
- iCal remains the default and its existing behavior is unchanged.
- COROS Calendar reads structured workouts from the COROS Training Hub calendar.
- The first version is read-only: it does not create, edit, delete, or schedule workouts.
- AI calendar writes are explicitly out of scope for this version.

## Assumptions

- The installation is single-user and COROS credentials are already configured.
- Source selection is browser-local and starts on iCal.
- The visible six-week calendar range is the only range fetched.

## Decision log

| Decision | Alternatives | Reason |
|---|---|---|
| Use a source selector in Training Plan | Separate COROS Calendar route | Reuses the existing calendar and detail panel without duplicate UI. |
| Keep COROS mode read-only | Add AI or manual calendar writes now | A read path verifies session and payload handling before external writes. |
| Surface COROS errors | Silent fallback to iCal | The selected source must remain truthful. |

## Design

The frontend sends `source=ical` or `source=coros` while retaining the existing
calendar grid and selected-day detail panel. The backend uses the current iCal
parser for `ical`. For `coros`, it reads the displayed date range from the
COROS Training Hub calendar endpoint and normalizes safe summary fields into
the existing event response shape. Missing credentials and Training Hub errors
are shown only in COROS mode. Tests cover source selection, date conversion,
and normalization with mocked COROS responses.
