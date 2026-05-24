# study-buddy

Personal-mode skill for the Reading & Study panel.

## Capabilities
- Summarise a reading source (Drive doc, URL, uploaded PDF/EPUB)
- Generate flashcards (`POST /api/personal/flashcards`) using an Anki-style
  *front / back* schema
- Drive the spaced-repetition queue (the API implements an SM-2-lite update
  on `PATCH /api/personal/flashcards`)
- Run quiz sessions in chat: ask `front`, grade the user's recall (0–5),
  PATCH the card to advance its interval
- "Explain like I'm…" presets for any saved highlight

## Inputs
Source body (resolved server-side from `reading_sources.id`) + optional
user-supplied focus areas.

## Output
Flashcards: array of `{ front, back, tags? }`. Persisted via the
flashcards API which sets `ease=2.5`, `interval_days=0`, `due_at=now()`.
