# AI Coach UI Design

## Scope

Restyle `/ai` as a COROSLink-style coaching chat without changing API, session,
streaming, persistence, or prompt behavior.

## Decisions

- Keep the existing conversation session rail and chat behavior.
- Use a desktop split layout with a responsive stacked mobile layout.
- Show a coach welcome state with the existing suggested-prompt text.
- Remove model-selection user interface and present one fixed coach.
- Keep export and print actions only for active conversations.

## Non-goals

- No new AI provider, model selection, backend endpoint, or dependency.
