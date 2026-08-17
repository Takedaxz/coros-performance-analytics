# Activity Notes for AI Coach

## Goal

Let an athlete save one private note on an activity and let AI Coach use it
only when it retrieves that activity's detail or compares that activity.

## Design

- Add nullable `activity_note` text to `activities` through an Alembic
  migration.
- Return the note from the existing activity-detail endpoint.
- Add an owner-scoped update endpoint that accepts a note up to 2,000
  characters; an empty value clears the note.
- Add a textarea and explicit Save button on the Activity Detail page.
- Include a non-empty note in `get_activity_detail` and activity-comparison
  tool results only. Do not put it in activity-list results or the initial AI
  context snapshot.

## Validation

- Backend tests cover saving and owner isolation, and assert tool output
  includes the note only at the selected detail/comparison boundaries.
- Frontend lint covers the edited Activity Detail page.
