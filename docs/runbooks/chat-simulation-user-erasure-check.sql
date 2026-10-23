-- Chat simulation: verify an erasure (NFR-2). Parameter $1: the user's uid.
-- Every column must be 0. (The remote ids are queued, not yet deleted:
-- see chat-simulation-retention-audit.sql for the queue backlog.)
SELECT
  (SELECT count(*) FROM chat_simulation.sessions WHERE user_id = $1)
    AS sessions_left,
  (SELECT count(*) FROM chat_simulation.messages m
     WHERE NOT EXISTS (SELECT 1 FROM chat_simulation.sessions s
                       WHERE s.id = m.session_id))
    AS orphan_messages;
