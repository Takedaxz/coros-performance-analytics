# OKMD Session Model Selection

## Understanding

- Discover available models from the configured OKMD gateway.
- Let each AI Coach chat session keep its selected model.
- Use the configured OKMD model for new sessions by default.
- Keep the OKMD API key on the backend.
- Preserve existing sessions by falling back to the configured default.

## Assumptions

- This is a single-user installation with low request volume.
- OKMD supports the OpenAI-compatible `GET /models` endpoint.
- Model pricing and context-window metadata are out of scope.
- A five-minute cache is sufficient for model-list freshness.

## Design

The backend proxies model discovery, caches the returned IDs for five minutes,
and falls back to the configured default model if discovery fails. A nullable
`model_name` column on `chat_sessions` stores the per-session selection. The
session stream passes that model to the existing OpenAI-compatible client.

The AI Coach header shows a native model selector. Selecting a model updates
the active session; a selection made before the first message is included when
the session is created.

## Decision Log

- Selected backend discovery instead of browser discovery to protect the API key.
- Selected a session column instead of frontend-only state so model choice persists.
- Selected a native `<select>` instead of a custom picker to minimize UI complexity.
- Selected a five-minute in-process cache instead of Redis because this is a
  single-process, single-user application.
