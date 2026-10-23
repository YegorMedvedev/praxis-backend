import type { Clock } from '../../../shared/clock';
import {
  NoReplyPendingError,
  ReplyPendingError,
  ServiceUnavailableError,
  SessionEndedError,
  SessionNotFoundError,
} from '../../../shared/domain-error';
import type { IdGenerator } from '../../../shared/id-generator';
import {
  characterCount,
  PATIENT_REPLY_MAX_CHARS,
  type Message,
} from '../domain/message';
import type { MessageRepository } from '../domain/message-repository';
import type {
  PatientReplyGenerator,
  ReplyChunk,
  ReplyRequest,
} from '../domain/patient-reply-generator';
import type { RemoteSessionDeletionQueue } from '../domain/remote-session-deletion-queue';
import type { SessionRepository } from '../domain/session-repository';
import type { UnitOfWork } from '../domain/unit-of-work';
import type {
  GenerationClaim,
  GenerationRegistry,
} from './generation-registry';

/** Spec 02 FR-7: 15 s idle limit; keep-alives at <= 15 s intervals. */
export interface ReplyTimings {
  /** No text for this long (after the start, or between chunks) fails. */
  idleTimeoutMs: number;
  /** A keep-alive is due when nothing was sent for this long. */
  keepAliveMs: number;
}

export const DEFAULT_REPLY_TIMINGS: ReplyTimings = {
  idleTimeoutMs: 15_000,
  // Below the idle limit so a keep-alive is always sent before a stall fails
  // (spec 02 says "every 15 s" for both; see PROGRESS.md).
  keepAliveMs: 10_000,
};

/** The only failures a stream reports; both have problem types. */
export type ReplyFailureCode =
  'reply-generation-failed' | 'service-unavailable';

/**
 * What the use case tells the presentation layer to write. `session.ended`
 * is deliberately absent: the patient cannot end a session in this milestone.
 */
export type ReplyStreamEvent =
  | { type: 'started'; messageId: string }
  | { type: 'delta'; messageId: string; index: number; text: string }
  | { type: 'completed'; message: Message }
  | { type: 'keep-alive' }
  | {
      type: 'error';
      code: ReplyFailureCode;
      /** Class name only, for logs. Never a message. */
      errorClass: string;
    };

export interface PatientReplyStream {
  /**
   * Ends after `completed` or `error`, or silently when the generation was
   * cancelled (disconnect, session ended or discarded): no event then.
   */
  events: AsyncGenerator<ReplyStreamEvent>;
  /** Cancels the generation and frees the session. Idempotent. */
  close(): void;
}

interface Prepared {
  request: ReplyRequest;
  userId: string;
  sessionId: string;
}

type Outcome<T> =
  | { type: 'value'; value: T }
  | { type: 'error'; error: unknown }
  | { type: 'timeout' }
  | { type: 'aborted' };

/** Waits for `promise`, a timer or the abort, whichever comes first. */
function raceNext<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal,
): Promise<Outcome<T>> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ type: 'aborted' });
      return;
    }
    const done = (outcome: Outcome<T>): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = (): void => done({ type: 'aborted' });
    const timer = setTimeout(() => done({ type: 'timeout' }), ms);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => done({ type: 'value', value }),
      (error: unknown) => done({ type: 'error', error }),
    );
  });
}

function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

/**
 * Generates and streams the patient's next message (the opening, or the reply
 * to the pending therapist message).
 *
 * - Everything that can be rejected is rejected before the stream starts, as
 *   an ordinary domain error.
 * - At most one generation per session (single-flight, in process).
 * - The patient message is stored only when the generator completed and the
 *   bound holds, and only if the session is still in progress. Failure,
 *   time-out, disconnect, end and discard store nothing.
 */
export class StreamPatientReply {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly messages: MessageRepository,
    private readonly generator: PatientReplyGenerator,
    private readonly registry: GenerationRegistry,
    private readonly deletions: RemoteSessionDeletionQueue,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly timings: ReplyTimings = DEFAULT_REPLY_TIMINGS,
  ) {}

  async execute(
    userId: string,
    sessionId: string,
  ): Promise<PatientReplyStream> {
    const known = await this.sessions.findOwned(sessionId, userId);
    if (!known) throw new SessionNotFoundError('session not found');
    if (!known.isInProgress()) {
      throw new SessionEndedError('session already ended');
    }

    // Synchronous claim: of two concurrent requests exactly one gets it.
    const claim = this.registry.tryAcquire(sessionId);
    if (!claim) {
      throw new ReplyPendingError('a reply is already being generated');
    }

    try {
      const prepared = await this.prepare(userId, sessionId);
      const messageId = this.ids.next();
      return {
        events: this.stream(prepared, messageId, claim),
        close: () => claim.release(),
      };
    } catch (error) {
      claim.release();
      throw error;
    }
  }

  /**
   * Re-reads the state under the session lock (it may have changed since the
   * first read) and marks the remote conversation as possibly out of sync:
   * only a stored reply sets it back, so any other ending leaves it false.
   */
  private prepare(userId: string, sessionId: string): Promise<Prepared> {
    return this.unitOfWork.run(async () => {
      const session = await this.sessions.lockOwned(sessionId, userId);
      if (!session) throw new SessionNotFoundError('session not found');
      if (!session.isInProgress()) {
        throw new SessionEndedError('session already ended');
      }
      const stored = await this.messages.listBySession(sessionId);
      const last = stored.at(-1) ?? null;
      if (last?.role === 'PATIENT') {
        throw new NoReplyPendingError('the last message is from the patient');
      }
      const before = session.snapshot();
      session.markRemoteInSync(false);
      await this.sessions.save(session);
      return {
        userId,
        sessionId,
        request: {
          session: {
            id: before.id,
            language: before.language,
            agentId: before.agentId,
            openaiSessionId: before.openaiSessionId,
            remoteInSync: before.remoteInSync,
          },
          history: last ? stored.slice(0, -1) : [],
          pending: last,
        },
      };
    });
  }

  private async *stream(
    prepared: Prepared,
    messageId: string,
    claim: GenerationClaim,
  ): AsyncGenerator<ReplyStreamEvent> {
    const { signal } = claim;
    const { idleTimeoutMs, keepAliveMs } = this.timings;
    let iterator: AsyncIterator<ReplyChunk> | undefined;
    // The slot is freed BEFORE an error event is handed out, so a client that
    // retries the instant it sees the error never gets a spurious
    // `reply-pending`.
    const fail = (error: unknown): ReplyStreamEvent => {
      claim.release();
      return {
        type: 'error',
        code:
          error instanceof ServiceUnavailableError
            ? 'service-unavailable'
            : 'reply-generation-failed',
        errorClass: errorClassOf(error),
      };
    };
    const failed = (errorClass: string): ReplyStreamEvent => {
      claim.release();
      return {
        type: 'error',
        code: 'reply-generation-failed',
        errorClass,
      };
    };
    let next: Promise<IteratorResult<ReplyChunk>> | undefined;

    try {
      if (signal.aborted) return;
      yield { type: 'started', messageId };

      let text = '';
      let index = 0;
      let currentRemote = prepared.request.session.openaiSessionId;
      let lastProgress = performance.now();
      let lastSent = lastProgress;
      let completed = false;

      try {
        iterator = this.generator
          .generate(prepared.request, signal)
          [Symbol.asyncIterator]();
      } catch (error) {
        yield fail(error);
        return;
      }

      while (!completed) {
        next ??= iterator.next();
        const idleAt = lastProgress + idleTimeoutMs;
        const keepAliveAt = lastSent + keepAliveMs;
        const idleFirst = idleAt <= keepAliveAt;
        const wait = Math.max(
          0,
          Math.min(idleAt, keepAliveAt) - performance.now(),
        );
        const outcome = await raceNext(next, wait, signal);

        if (outcome.type === 'aborted') return;
        if (outcome.type === 'timeout') {
          if (idleFirst) {
            yield failed('ReplyTimeout');
            return;
          }
          const before = performance.now();
          yield { type: 'keep-alive' };
          // Time the consumer spent draining is not generator silence.
          const after = performance.now();
          lastProgress += after - before;
          lastSent = after;
          continue;
        }
        next = undefined;
        if (outcome.type === 'error') {
          if (!signal.aborted) yield fail(outcome.error);
          return;
        }
        if (outcome.value.done) {
          yield failed('StreamEndedEarly');
          return;
        }

        const chunk = outcome.value.value;
        if (chunk.kind === 'remote-session') {
          let kept: boolean;
          try {
            kept = await this.persistRemoteSession(
              prepared,
              chunk.openaiSessionId,
              currentRemote,
            );
          } catch (error) {
            await this.queueOrphan(chunk.openaiSessionId);
            yield fail(error);
            return;
          }
          currentRemote = chunk.openaiSessionId;
          if (!kept) return;
        } else if (chunk.kind === 'text') {
          if (chunk.text.length === 0) continue;
          if (chunk.text.includes('\u0000')) {
            yield failed('InvalidReplyText');
            return;
          }
          text += chunk.text;
          if (characterCount(text) > PATIENT_REPLY_MAX_CHARS) {
            yield failed('ReplyTooLong');
            return;
          }
          yield { type: 'delta', messageId, index, text: chunk.text };
          index += 1;
          lastProgress = lastSent = performance.now();
        } else {
          completed = true;
        }
      }

      if (text.trim().length === 0) {
        yield failed('EmptyReply');
        return;
      }
      let stored: Message | null;
      try {
        stored = await this.store(prepared, messageId, text, signal);
      } catch (error) {
        yield fail(error);
        return;
      }
      // Ended, discarded or cancelled meanwhile: nothing was stored.
      if (!stored) return;
      // Normal end: free the slot without aborting the signal.
      claim.finish();
      yield { type: 'completed', message: stored };
    } finally {
      claim.release();
      // A remote session announced by a chunk we never consumed (abort or
      // time-out won the race) would be orphaned: queue it for deletion.
      if (next) {
        void next
          .then((step) => {
            if (!step.done && step.value.kind === 'remote-session') {
              return this.queueOrphan(step.value.openaiSessionId);
            }
          })
          .catch(() => undefined);
      }
      try {
        void Promise.resolve(iterator?.return?.()).catch(() => undefined);
      } catch {
        // A generator that cannot be closed has nothing more to give.
      }
    }
  }

  /** Best effort, in its own unit of work: queue a remote session we hold no row for. */
  private async queueOrphan(openaiSessionId: string): Promise<void> {
    try {
      await this.unitOfWork.run(() =>
        this.deletions.enqueue(openaiSessionId, this.clock.now()),
      );
    } catch {
      // Nothing more can be done; the remote session ages out on its own.
    }
  }

  /**
   * Persists the remote conversation id before any text is forwarded, and
   * queues a replaced or orphaned remote conversation for deletion. Returns
   * false when the session no longer exists (the new remote one is queued).
   */
  private persistRemoteSession(
    prepared: Prepared,
    openaiSessionId: string,
    current: string | null,
  ): Promise<boolean> {
    if (openaiSessionId === current) return Promise.resolve(true);
    return this.unitOfWork.run(async () => {
      const now = this.clock.now();
      const session = await this.sessions.lockOwned(
        prepared.sessionId,
        prepared.userId,
      );
      if (!session) {
        await this.deletions.enqueue(openaiSessionId, now);
        return false;
      }
      const previous = session.openaiSessionId;
      if (previous && previous !== openaiSessionId) {
        await this.deletions.enqueue(previous, now);
      }
      session.attachRemoteSession(openaiSessionId);
      await this.sessions.save(session);
      return true;
    });
  }

  /** Stores the reply; null when the session cannot take it any more. */
  private store(
    prepared: Prepared,
    messageId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<Message | null> {
    return this.unitOfWork.run(async () => {
      if (signal.aborted) return null;
      const session = await this.sessions.lockOwned(
        prepared.sessionId,
        prepared.userId,
      );
      if (!session || !session.isInProgress()) return null;
      const last = await this.messages.findLast(prepared.sessionId);
      if (last?.role === 'PATIENT') return null;
      const message: Message = {
        id: messageId,
        sessionId: prepared.sessionId,
        role: 'PATIENT',
        text,
        createdAt: this.clock.now(),
      };
      await this.messages.append(message);
      session.markRemoteInSync(true);
      await this.sessions.save(session);
      return message;
    });
  }
}
