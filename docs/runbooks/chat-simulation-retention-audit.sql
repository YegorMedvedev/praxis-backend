-- Chat simulation: retention audit (05 NFR-1, AC-7). Read-only, no parameters.
-- Run at least daily and alert on any non-zero value in the first four columns.
--   sessions_past_deadline / messages_past_deadline
--       transcripts older than 90 days + 24 hours after created_at (NFR-1)
--   orphan_messages
--       messages whose session no longer exists (must be impossible: FK cascade)
--   remote_deletions_overdue
--       remote OpenAI sessions still queued 24 hours after being queued: the
--       cleanup worker is failing or stopped (FR-7, AC-7)
--   remote_deletions_pending
--       informational: queue backlog right now
SELECT
  (SELECT count(*) FROM chat_simulation.sessions
     WHERE created_at < now() - interval '90 days 24 hours')
    AS sessions_past_deadline,
  (SELECT count(*) FROM chat_simulation.messages m
     JOIN chat_simulation.sessions s ON s.id = m.session_id
     WHERE s.created_at < now() - interval '90 days 24 hours')
    AS messages_past_deadline,
  (SELECT count(*) FROM chat_simulation.messages m
     WHERE NOT EXISTS (SELECT 1 FROM chat_simulation.sessions s
                       WHERE s.id = m.session_id))
    AS orphan_messages,
  (SELECT count(*) FROM chat_simulation.agent_session_deletions
     WHERE created_at < now() - interval '24 hours')
    AS remote_deletions_overdue,
  (SELECT count(*) FROM chat_simulation.agent_session_deletions)
    AS remote_deletions_pending;
