import type { CaseAgentDirectory } from '../domain/case-agent-directory';
import type { CaseCompletionRecorder } from '../domain/case-completion-recorder';
import type { Language } from '../domain/language';
import type {
  PendingRemoteDeletion,
  RemoteSessionDeletionQueue,
} from '../domain/remote-session-deletion-queue';
import type { RemoteSessionRemover } from '../domain/remote-session-remover';
import { Session, type SessionWithStats } from '../domain/session';
import type {
  RemovedSession,
  SessionRepository,
} from '../domain/session-repository';
import type { SessionGenerationCanceller } from '../domain/session-generation-canceller';
import type { UnitOfWork } from '../domain/unit-of-work';

/** In-memory fakes for use case tests. */

/** A store whose state a failed unit of work rolls back. */
interface Transactional {
  snapshot(): () => void;
}

export class InMemorySessionRepository
  implements SessionRepository, Transactional
{
  readonly sessions = new Map<string, Session>();
  readonly messageCounts = new Map<
    string,
    { therapist: number; patient: number }
  >();

  setMessageCounts(id: string, therapist: number, patient: number): void {
    this.messageCounts.set(id, { therapist, patient });
  }

  snapshot(): () => void {
    const sessions = new Map(
      [...this.sessions].map(([id, s]) => [id, Session.restore(s.snapshot())]),
    );
    return () => {
      this.sessions.clear();
      for (const [id, s] of sessions) this.sessions.set(id, s);
    };
  }

  insert(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }

  private owned(id: string, userId: string): Session | null {
    const session = this.sessions.get(id);
    return session && session.userId === userId ? session : null;
  }

  findOwnedWithStats(
    id: string,
    userId: string,
  ): Promise<SessionWithStats | null> {
    const session = this.owned(id, userId);
    if (!session) return Promise.resolve(null);
    const counts = this.messageCounts.get(id) ?? { therapist: 0, patient: 0 };
    return Promise.resolve({
      session: Session.restore(session.snapshot()),
      therapistMessageCount: counts.therapist,
      patientMessageCount: counts.patient,
    });
  }

  lockOwned(id: string, userId: string): Promise<Session | null> {
    const session = this.owned(id, userId);
    return Promise.resolve(
      session ? Session.restore(session.snapshot()) : null,
    );
  }

  save(session: Session): Promise<void> {
    this.sessions.set(session.id, Session.restore(session.snapshot()));
    return Promise.resolve();
  }

  deleteOwned(id: string, userId: string): Promise<RemovedSession | null> {
    const session = this.owned(id, userId);
    if (!session) return Promise.resolve(null);
    this.sessions.delete(id);
    return Promise.resolve({ id, openaiSessionId: session.openaiSessionId });
  }

  deleteAllForUserCase(
    userId: string,
    caseId: string,
  ): Promise<RemovedSession[]> {
    const removed: RemovedSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.caseId === caseId) {
        this.sessions.delete(session.id);
        removed.push({
          id: session.id,
          openaiSessionId: session.openaiSessionId,
        });
      }
    }
    return Promise.resolve(removed);
  }
}

export class InMemoryDeletionQueue
  implements RemoteSessionDeletionQueue, Transactional
{
  readonly entries = new Map<
    string,
    { attempts: number; nextAttemptAt: Date }
  >();

  snapshot(): () => void {
    const copy = new Map(
      [...this.entries].map(([id, entry]) => [id, { ...entry }]),
    );
    return () => {
      this.entries.clear();
      for (const [id, entry] of copy) this.entries.set(id, entry);
    };
  }

  enqueue(openaiSessionId: string, now: Date): Promise<void> {
    if (!this.entries.has(openaiSessionId)) {
      this.entries.set(openaiSessionId, { attempts: 0, nextAttemptAt: now });
    }
    return Promise.resolve();
  }

  findDue(now: Date, limit: number): Promise<PendingRemoteDeletion[]> {
    return Promise.resolve(
      [...this.entries]
        .filter(([, entry]) => entry.nextAttemptAt <= now)
        .slice(0, limit)
        .map(([openaiSessionId, entry]) => ({
          openaiSessionId,
          attempts: entry.attempts,
        })),
    );
  }

  complete(openaiSessionId: string): Promise<void> {
    this.entries.delete(openaiSessionId);
    return Promise.resolve();
  }

  reschedule(
    openaiSessionId: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    this.entries.set(openaiSessionId, { attempts, nextAttemptAt });
    return Promise.resolve();
  }
}

export class InMemoryCompletionRecorder
  implements CaseCompletionRecorder, Transactional
{
  readonly completed = new Set<string>();
  /** When set, `record` rejects: simulates a failure between the two writes. */
  failWith: Error | null = null;

  static key(userId: string, caseId: string): string {
    return JSON.stringify([userId, caseId]);
  }

  snapshot(): () => void {
    const copy = new Set(this.completed);
    return () => {
      this.completed.clear();
      for (const key of copy) this.completed.add(key);
    };
  }

  has(userId: string, caseId: string): boolean {
    return this.completed.has(InMemoryCompletionRecorder.key(userId, caseId));
  }

  record(userId: string, caseId: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.completed.add(InMemoryCompletionRecorder.key(userId, caseId));
    return Promise.resolve();
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly stores: Transactional[]) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    const rollbacks = this.stores.map((store) => store.snapshot());
    try {
      return await work();
    } catch (error) {
      rollbacks.forEach((rollback) => rollback());
      throw error;
    }
  }
}

export class InMemoryCaseAgentDirectory implements CaseAgentDirectory {
  private readonly agents = new Map<string, string>();

  set(caseId: string, language: Language, agentId: string): void {
    this.agents.set(`${caseId}:${language}`, agentId);
  }

  findAgentId(caseId: string, language: Language): Promise<string | null> {
    return Promise.resolve(this.agents.get(`${caseId}:${language}`) ?? null);
  }
}

export class RecordingCanceller implements SessionGenerationCanceller {
  readonly cancelled: string[] = [];
  cancel(sessionId: string): void {
    this.cancelled.push(sessionId);
  }
}

/** Scripted remover: fails the first `failures` calls, then succeeds. */
export class FakeRemoteSessionRemover implements RemoteSessionRemover {
  readonly removed: string[] = [];
  readonly calls: string[] = [];
  failures = 0;

  remove(openaiSessionId: string): Promise<void> {
    this.calls.push(openaiSessionId);
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('remote unavailable'));
    }
    this.removed.push(openaiSessionId);
    return Promise.resolve();
  }
}
