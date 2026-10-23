import type { CaseAgentDirectory } from '../domain/case-agent-directory';
import type { CaseCompletionRecorder } from '../domain/case-completion-recorder';
import { ReplyGenerationFailedError } from '../../../shared/domain-error';
import type { Language } from '../domain/language';
import type { Message } from '../domain/message';
import type { MessageRepository } from '../domain/message-repository';
import type {
  PatientReplyGenerator,
  ReplyChunk,
  ReplyRequest,
} from '../domain/patient-reply-generator';
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

  findOwned(id: string, userId: string): Promise<Session | null> {
    const session = this.owned(id, userId);
    return Promise.resolve(
      session ? Session.restore(session.snapshot()) : null,
    );
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

  deleteExpired(cutoff: Date, limit: number): Promise<RemovedSession[]> {
    const expired = [...this.sessions.values()]
      .filter((s) => s.createdAt.getTime() <= cutoff.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
    for (const session of expired) this.sessions.delete(session.id);
    return Promise.resolve(
      expired.map((s) => ({ id: s.id, openaiSessionId: s.openaiSessionId })),
    );
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

export class InMemoryMessageRepository
  implements MessageRepository, Transactional
{
  readonly bySession = new Map<string, Message[]>();
  /** When set, `append` rejects: simulates a failing write. */
  failAppendWith: Error | null = null;

  snapshot(): () => void {
    const copy = new Map(
      [...this.bySession].map(([id, list]) => [id, [...list]]),
    );
    return () => {
      this.bySession.clear();
      for (const [id, list] of copy) this.bySession.set(id, list);
    };
  }

  all(sessionId: string): Message[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  listBySession(sessionId: string): Promise<Message[]> {
    return Promise.resolve(this.all(sessionId));
  }

  findLast(sessionId: string): Promise<Message | null> {
    return Promise.resolve(this.all(sessionId).at(-1) ?? null);
  }

  append(message: Message): Promise<void> {
    if (this.failAppendWith) return Promise.reject(this.failAppendWith);
    this.bySession.set(message.sessionId, [
      ...this.all(message.sessionId),
      message,
    ]);
    return Promise.resolve();
  }
}

export type ScriptStep =
  | { type: 'remote-session'; openaiSessionId: string }
  | { type: 'text'; text: string }
  /** Pauses (abort-aware) before the next step. */
  | { type: 'wait'; ms: number }
  /** Rejects with `error` (default `ReplyGenerationFailedError`). */
  | { type: 'fail'; error?: Error }
  /** Never produces anything again; only the abort ends it. */
  | { type: 'stall' };

export interface ReplyScript {
  steps: ScriptStep[];
  /** Yield the final `completed` marker after the steps (default true). */
  complete?: boolean;
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

/**
 * Scripted `PatientReplyGenerator`. Each call plays the next queued script
 * (or a one-delta success when none is queued). Abort-aware: a wait or stall
 * ends as soon as the signal aborts, and `aborted` counts such endings.
 */
export class FakePatientReplyGenerator implements PatientReplyGenerator {
  readonly requests: ReplyRequest[] = [];
  /** Generations that were cut short by their abort signal. */
  aborted = 0;
  /** Generations that were started. */
  started = 0;
  private readonly scripts: ReplyScript[] = [];

  static success(...deltas: string[]): ReplyScript {
    return { steps: deltas.map((text) => ({ type: 'text', text })) };
  }

  /** Emits `deltas`, then fails. */
  static failAfter(deltas: string[], error?: Error): ReplyScript {
    return {
      steps: [
        ...deltas.map((text) => ({ type: 'text' as const, text })),
        { type: 'fail', error },
      ],
    };
  }

  /** Emits `deltas`, then never produces anything again. */
  static stallAfter(...deltas: string[]): ReplyScript {
    return {
      steps: [
        ...deltas.map((text) => ({ type: 'text' as const, text })),
        { type: 'stall' },
      ],
    };
  }

  enqueue(...scripts: ReplyScript[]): this {
    this.scripts.push(...scripts);
    return this;
  }

  async *generate(
    request: ReplyRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ReplyChunk> {
    this.requests.push(request);
    this.started += 1;
    const script =
      this.scripts.shift() ?? FakePatientReplyGenerator.success('Hello.');
    for (const step of script.steps) {
      if (signal.aborted) break;
      switch (step.type) {
        case 'remote-session':
          yield {
            kind: 'remote-session',
            openaiSessionId: step.openaiSessionId,
          };
          break;
        case 'text':
          yield { kind: 'text', text: step.text };
          break;
        case 'wait':
          await sleep(step.ms, signal);
          break;
        case 'stall':
          await sleep(2_000_000_000, signal);
          break;
        case 'fail':
          throw (
            step.error ?? new ReplyGenerationFailedError('scripted failure')
          );
      }
    }
    if (signal.aborted) {
      this.aborted += 1;
      return;
    }
    if (script.complete !== false) yield { kind: 'completed' };
  }
}
