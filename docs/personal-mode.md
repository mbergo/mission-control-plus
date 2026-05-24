# Personal mode — Mission Control · Life

Mission Control ships an optional **personal mode** that repurposes the
dashboard into a single-user life OS for a consumer `@gmail.com` account:
daily briefings, Gmail/Calendar/Tasks summaries, reading queue, spaced
repetition flashcards, and a daily journal.

Enable it by setting:

```bash
MC_MODE=personal
```

in your `.env` and restarting the app. In team mode (the default) none of the
personal panels are shown and no Google data is fetched.

## What you get

| Panel | Route | Notes |
| --- | --- | --- |
| Today | `/today` (also replaces `/overview`) | Daily home — agenda + inbox highlights + due flashcards + journal status + latest briefing |
| Inbox | `/inbox` | Read-only Gmail summaries with arbitrary search query |
| Calendar | `/calendar` | Read-only agenda, 1/2/7/14 days ahead, grouped by day |
| Reading | `/reading` | Reading queue with status workflow + flashcards (SM-2 lite spaced repetition) |
| Journal | `/journal` | Daily entry with mood/energy 1–5 and free-form markdown |
| Briefings | `/briefings` | Archive of past morning / evening / weekly briefings |

All team panels (gateways, multi-tenant user mgmt, agent squads, exec
approvals, GitHub sync, channels, webhooks, alerts) are hidden from the nav
when `MC_MODE=personal`.

## Set up the Google OAuth client (consumer)

This integration uses **per-user OAuth 2.0 with PKCE** against the standard
Google Identity endpoints. It does **not** use the `gws` / Google Workspace
admin CLI, which targets commercial Workspace tenants and won't work for a
consumer `@gmail.com` account.

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. Open **APIs & Services → OAuth consent screen** and configure it as
   **External**. Add yourself as a **test user**. Keep the app **Unverified**
   — Google's 100-test-user cap is plenty for personal use.
3. Enable the APIs you want to use:
   - Gmail API
   - Google Calendar API
   - Google Tasks API
   - (Optional) Google Drive API + Google Docs API
   - (Optional) People API (for Contacts)
4. Under **Credentials**, create an **OAuth client ID** of type **Web
   application**.
   - Authorized redirect URI: `http://localhost:3000/api/google/auth/callback`
     (or whatever public URL you serve Mission Control under).
5. Copy the client ID and secret into your `.env`:

   ```bash
   MC_MODE=personal
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=...
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/google/auth/callback
   ```

6. Restart the app and open **Inbox** (or any Google-backed panel). Click
   **Connect Google**, accept the consent screen (you'll see the
   "Google hasn't verified this app" warning — that's expected for a personal
   unverified client), and you'll be redirected back to `/integrations` with
   tokens stored.

### Scopes requested

Scopes are requested **incrementally** per feature. The default set is the
least-privilege bundle for read-only briefings:

| Scope | Used for |
| --- | --- |
| `openid email profile` | Identity (already used by the existing Google Sign-In) |
| `gmail.readonly` | Inbox + briefings + triage |
| `calendar.readonly` | Today / Calendar / meeting prep |
| `tasks` | Surfacing open Google Tasks |
| `gmail.modify` (opt-in) | Drafting replies / archiving / labeling |
| `calendar.events` (opt-in) | Creating or editing events |
| `drive.readonly`, `documents.readonly` (opt-in) | Reading Drive docs into the study panel |
| `contacts.readonly` (opt-in) | Person-context for meeting prep cards |

You can request additional scopes by appending them to the start URL:

```text
/api/google/auth/start?scopes=gmail.readonly,calendar.readonly,tasks,drive.readonly
```

### Token storage

Access and refresh tokens are encrypted at rest with AES-256-GCM keyed by a
SHA-256 derivation of your `AUTH_SECRET`. They are stored in the
`google_oauth_tokens` table, one row per Mission Control user. Disconnecting
calls Google's revoke endpoint and deletes the row.

> ⚠️ Ensure `AUTH_SECRET` is configured. With the default dev fallback
> tokens can still be decrypted by anyone who reads the SQLite file.

## Privacy: AI provider for personal data

Briefings and AI features happen in the existing skill/agent layer. Choose
your AI provider in **Settings → Integrations** as usual.

For maximum privacy, set:

```bash
MC_PERSONAL_AI_LOCAL_ONLY=1
```

This banner-flags personal-mode briefings as locally generated; the bundled
deterministic briefing template will not call any external model. AI skills
in the **Skills** panel can be configured to pin to an Ollama model.

## Endpoints

The personal-mode API surface lives under `/api/google/**` and
`/api/personal/**`:

```text
GET  /api/personal/mode                    # public — returns { mode, personalAiLocalOnly }
GET  /api/personal/today                   # today payload (cached only)
GET  /api/personal/briefings               # archive
POST /api/personal/briefings               # generate (or store an AI-supplied) brief
GET  /api/personal/journal?date=YYYY-MM-DD # fetch entry
POST /api/personal/journal                 # upsert entry
GET  /api/personal/reading                 # reading queue
POST /api/personal/reading                 # add source
PATCH /api/personal/reading                # update status/notes
DELETE /api/personal/reading?id=…
GET  /api/personal/flashcards?due=1
POST /api/personal/flashcards
PATCH /api/personal/flashcards             # SM-2 review (quality 0..5)
DELETE /api/personal/flashcards?id=…

GET  /api/google/auth/start?scopes=…       # builds the consent URL
GET  /api/google/auth/callback             # OAuth callback
GET  /api/google/auth/status               # connected + granted scopes
POST /api/google/auth/disconnect           # revoke + delete tokens
GET  /api/google/gmail/messages?q=…&max=…
GET  /api/google/calendar/agenda?days=…
GET  /api/google/tasks/tasks
GET  /api/google/drive/files?q=…
```

Every Google API call is logged via `logAuditEvent` so you can see exactly
what the agent touched (find them in the **Audit** panel). Email addresses
are redacted in audit detail.

## Roadmap (post-foundation)

Phase 1 (this PR) lays the spine: OAuth, schema, read-only Google routes,
panels, briefing archive. Subsequent phases will:

- Wire cron-driven briefings via the existing scheduler (`morning brief at
  7:30`, `evening wrap at 21:00`, `weekly review Sunday 18:00`).
- Add an `inbox-triage` skill that proposes label / archive / draft actions
  behind explicit confirms.
- Add a `study-buddy` skill that summarises Drive docs / URLs and auto-
  generates flashcards.
- Add meeting prep cards that fire 30 min before each event.
- Surface a "Google (personal)" card in the **Integrations** panel with
  per-scope toggles and a clear **Disconnect & revoke** button.
