-- Chat simulation: erase one user's sessions and transcripts, and queue their
-- remote (OpenAI) sessions for deletion. ONE statement = one atomic commit.
--
-- Parameter $1: the user's Firebase uid, taken from Firebase (never an email
-- and never free-form text from a ticket; resolve it first). Bind it, never
-- paste it into the SQL. With psql:
--   \set uid 'the-uid-from-firebase'
--   PREPARE erase(text) AS <this statement, with $1>;
--   EXECUTE erase(:'uid');
-- (:'uid' quotes the value safely.) Or run it from a client that binds
-- parameters. Messages go with their session
-- (ON DELETE CASCADE). A session without an openai_session_id has no remote
-- session to queue and is still deleted. Case completion is not touched.
-- Idempotent: running it again deletes and queues nothing.
WITH deleted AS (
  DELETE FROM chat_simulation.sessions
  WHERE user_id = $1
  RETURNING id, openai_session_id
),
queued AS (
  INSERT INTO chat_simulation.agent_session_deletions
    (openai_session_id, attempts, next_attempt_at, created_at)
  SELECT DISTINCT openai_session_id, 0, now(), now()
  FROM deleted
  WHERE openai_session_id IS NOT NULL
  ON CONFLICT (openai_session_id) DO NOTHING
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM deleted) AS sessions_deleted,
  (SELECT count(*) FROM deleted WHERE openai_session_id IS NOT NULL)
    AS sessions_with_remote_id,
  (SELECT count(*) FROM queued) AS remote_sessions_queued;
