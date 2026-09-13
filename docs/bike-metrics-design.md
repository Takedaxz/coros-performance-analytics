# Bike Metrics chart

## Decision

Show cadence, power, and speed for ride activities using the existing activity-records
response and the running-dynamics chart layout.

## Data contract

The stored FIT records already provide `cadence`, `power_w`, and `speed_mps`.
The client converts speed to km/h. Tabs appear only for metrics with positive samples;
zero cadence and power values are omitted from the chart and averages.

## Non-goals

No FIT-parser, API, database, migration, or generic chart-component change.
