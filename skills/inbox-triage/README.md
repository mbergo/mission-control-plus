# inbox-triage

Personal-mode skill that categorises recent Gmail threads, produces short
summaries, and proposes label / archive / draft-reply actions. Writes never
happen automatically — every proposed action must surface in the UI for
explicit confirmation by the user.

## Categories
- `newsletter` — promotional / digests
- `personal` — non-work conversations
- `action-needed` — explicit question or commitment owed
- `receipt` — transactional confirmations, no reply needed
- `other`

## Output
A JSON array per thread:

```json
{ "thread_id": "...", "category": "action-needed", "summary": "≤120 char summary",
  "proposed_actions": [{ "kind": "label", "value": "Followups" }, { "kind": "draft", "reply_md": "..." }] }
```

Requires `gmail.modify` scope only for the apply step; the analysis step is
read-only.
