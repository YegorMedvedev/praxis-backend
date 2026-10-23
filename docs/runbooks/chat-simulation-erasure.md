# Chat simulation: retention, erasure and audit runbook

Applies to schema `chat_simulation` (sessions, messages, remote-deletion queue). Covers
05 FR-6, FR-7, FR-8, FR-18, NFR-1, NFR-2 and FR-11. There is deliberately no API for any of it.

## Automatic retention (no operator action)

- Every session is deleted with its messages once `created_at + 90 days` has passed,
  whatever its status. Case completion is kept (it lives in `case_library`).
- `RetentionWorker` (in-process, single instance, not started when `NODE_ENV=test`) runs a pass
  10 s after boot and then every 6 hours. A pass deletes in batches of 200 (at most 500 batches),
  and queues each deleted session's `openai_session_id` in `agent_session_deletions` in the
  same transaction. The `SessionDeletionWorker` (every 30 s) then deletes the remote sessions
  with exponential backoff.
- NFR-1 (nothing older than 90 d + 24 h): a session is removed by the first pass after its
  90th day, so the worst case is one interval plus the pass duration (6 h + minutes, far
  below 24 h). The startup pass means a restart never postpones enforcement. As defence in
  depth the API already answers `session-not-found` for every session older than 90 days
  (GET, PATCH, messages, replies), even if a pass is late.
- Log lines: `retention_purge` (`sessions`, `remote_sessions_queued`, `batches`) and
  `retention_purge_failed` (error class only). Alert on `retention_purge_failed` and on the
  audit query below. Nobody sees a stopped worker otherwise.

## Audit (NFR-1, AC-7): `chat-simulation-retention-audit.sql`

Read-only. Run it at least daily (see HUMAN-REQUIRED for scheduling). Healthy = the first four
columns are 0. `sessions_past_deadline` or `messages_past_deadline` > 0 means the retention job
is failing (NFR-1 violated); `remote_deletions_overdue` > 0 means OpenAI deletion keeps failing
(FR-7). The audit shows the primary database only. Backups are outside SQL: the platform's
backup retention for this database must be <= 30 days so deleted transcripts leave backups
within 30 days (FR-7, FR-8).

## Manual erasure of one user (FR-8, NFR-2): `chat-simulation-user-erasure.sql`

Use when a user asks, by email, for their data to be erased (outside the app).

1. Verify the requester's identity per the support process, and resolve their Firebase uid.
   Never paste message text into tickets or chat.
2. Run `chat-simulation-user-erasure.sql` with `$1` = the uid, against the production database.
   It is a single statement (one transaction): it deletes every session of the user (messages
   cascade) and inserts each distinct non-null `openai_session_id` into
   `agent_session_deletions`. A session with a NULL `openai_session_id` (no remote session was
   ever created, or the id was never recorded) is deleted and queues nothing. Remote sessions
   already replaced earlier are already in the queue. Safe to run twice.
3. Verify with `chat-simulation-user-erasure-check.sql`: both columns must be 0.
4. Wait for the cleanup worker (normally under a minute) and confirm via the audit query that
   `remote_deletions_pending` returned to its normal level.
5. Backups: erasure from backups completes when the backup retention window (<= 30 days) has
   elapsed. Record the date. Also erase the user's other data (users module, Firebase)
   through their own processes; this runbook covers chat transcripts only.

Before step 2, disable or delete the user's Firebase account. Otherwise the user can sign in
and create new sessions right after the erasure. An in-flight reply stream for the erased user
may keep running for a few seconds, but it stores nothing (the session is gone), and its
remote session, if one was announced, is queued for deletion.

The check query cannot count the user's remote ids once the sessions are gone (the link is
deleted with the row). To confirm remote deletion, the operator watches
`remote_deletions_pending` in the audit query fall back to its normal level.

Known gap (accepted): a remote OpenAI session created just before a crash, whose id was never
stored, cannot be found from our database and is only removed by OpenAI's own expiry.

## Transcript access (FR-11, OQ-5)

No support or analytics tooling exposes transcript text, and none is to be built until OQ-5
(who may read transcripts, for what purpose, with what audit trail) is decided. The API has
no transcript export: the only route returning message text is
`GET /api/v1/sessions/{session_id}/messages` for the owning user (AC-17, covered by a test).
Direct database reads of `chat_simulation.messages` by engineers are not permitted outside
incidents; if one is needed, record who, when and why until an audit trail exists.
