import type { Session, SessionWithStats } from './session';

/** What a discard removed; the remote session (if any) still needs deleting. */
export interface RemovedSession {
  id: string;
  openaiSessionId: string | null;
}

/**
 * Every method takes part in the active unit of work (see `UnitOfWork`).
 * "Owned" means the session belongs to `userId`; another user's session is
 * indistinguishable from a missing one.
 */
export interface SessionRepository {
  insert(session: Session): Promise<void>;
  findOwnedWithStats(
    id: string,
    userId: string,
  ): Promise<SessionWithStats | null>;
  /** Reads the session and locks its row until the unit of work ends. */
  lockOwned(id: string, userId: string): Promise<Session | null>;
  /** Persists the mutable state of an existing session. */
  save(session: Session): Promise<void>;
  /** Removes the session and its messages; null when there was none. */
  deleteOwned(id: string, userId: string): Promise<RemovedSession | null>;
  /**
   * Removes every session of the user for the case, in any status, and
   * serialises concurrent callers for the same user and case.
   */
  deleteAllForUserCase(
    userId: string,
    caseId: string,
  ): Promise<RemovedSession[]>;
}
