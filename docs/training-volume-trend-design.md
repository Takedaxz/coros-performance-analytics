# Training volume trend

## Scope

Add a Trends-page chart that aggregates distance, duration, and training load by
calendar week, month, or year. It accepts a custom inclusive date range and a
sport filter that affects only this chart.

## Decisions

- The chart belongs on Trends; the Activities list remains paginated.
- The backend aggregates data, so all matching activities are included.
- Multiple selected metrics use relative bar heights and retain real values in
  the tooltip. A single selected metric uses its real axis.
- Current calendar periods remain visible and are labelled `To date`.
- Existing Trends panels remain unchanged.
