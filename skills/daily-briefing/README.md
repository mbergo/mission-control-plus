# daily-briefing

Personal-mode skill that produces a structured morning / evening / weekly
briefing for a single-user Mission Control instance.

## Inputs
- Latest cached Gmail thread summaries (`gmail_thread_cache`)
- Today + tomorrow Calendar events (`calendar_event_cache`)
- Open Google Tasks (`/api/google/tasks/tasks`)
- Optional: due flashcards count, reading queue, journal entries

## Output
Markdown briefing posted to `POST /api/personal/briefings` with `kind`,
`content_md`, `model_used`, and optional `cost_usd`. The dashboard's
**Today** and **Briefings** panels render it as-is.

## Suggested prompt skeleton

> You are a personal life-OS assistant. Produce a concise morning briefing in
> markdown. Sections (omit empty ones): *Calendar* (chronological, with
> attendees and prep notes), *Inbox highlights* (top 5 threads needing reply,
> 1-line summary each), *Tasks* (top 5 from Google Tasks), *Focus*
> (2-3 suggested deep-work blocks given the agenda), *Learning* (due
> flashcards + reading suggestion). Use ≤ 400 words. Do not invent events
> or emails. If a section's inputs are empty, omit it entirely.

When `MC_PERSONAL_AI_LOCAL_ONLY=1` is set, the skill must pin to an Ollama
local model.
