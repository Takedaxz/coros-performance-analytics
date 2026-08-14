# COROS Calendar Repeat Editor Design

## Understanding summary

- The Training Calendar editor must preserve COROS structured repeat groups.
- Interval Time is the reference: Warm Up, `Repeat 2 Times` containing Training and Rest, then Cool Down.
- The editor should follow CorosLink's nested-card behavior and the visual hierarchy of the COROS mobile app.
- Users can edit a repeat count and the child steps within a repeat block.
- Save calculates the complete workout, schedules it, and rereads it from COROS.
- AI and native grouped Training Plan Library writes remain out of scope.

## Assumptions

- Existing individual calendar-workout create, edit, move, and delete behavior remains available.
- A repeat block contains one or more editable child steps and repeats 1 to 99 times.
- Unsupported COROS fields stay unchanged only when an existing raw program is edited; new blocks use the verified Training Hub group-header shape.

## Decision log

| Decision | Alternatives | Reason |
|---|---|---|
| Use nested repeat cards | Flatten repeated steps into rows | Matches the COROS payload and makes intervals readable. |
| Reuse COROS group headers | Store repeat groups only in browser state | COROS requires a group exercise plus child exercises with a shared group ID. |
| Card-first editor | Keep the current dense table | Cards expose the workout flow and match the supplied COROS app reference. |
| Calculate then save | Write uncalculated draft | COROS calculation supplies totals and bar-chart data required for scheduling. |

## Design

The API represents an editor draft as an ordered list of nodes: a normal step
or a repeat node containing `repeat` and child steps. Reading a COROS program
reconstructs group headers (`isGroup: true`) and their children (`groupId`).
Saving rebuilds the flattened COROS `exercises[]` array with stable ordering,
allocates group and child IDs for new drafts, then calls the verified calculate
and calendar-schedule endpoints.

The frontend renders normal nodes as individual cards and repeat nodes as a
card group labelled `Repeat N Times`. Each card has a readable summary and an
expandable editor for its own target and intensity. Add controls create either
a normal step or a repeat block. The Interval Time library workout is the
focused regression case: its two-repeat Training/Rest block must remain a
repeat block after load, edit, and save.
