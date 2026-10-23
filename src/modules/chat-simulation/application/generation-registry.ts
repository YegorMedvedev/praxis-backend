import type { SessionGenerationCanceller } from '../domain/session-generation-canceller';

/** The right to generate one reply for one session. */
export interface GenerationClaim {
  /** Aborts when the claim is cancelled or released. */
  readonly signal: AbortSignal;
  /** Aborts the generation and frees the session. Idempotent; no-op after `finish`. */
  release(): void;
  /** Frees the session WITHOUT aborting: the generation ended normally. */
  finish(): void;
}

/**
 * Single-flight registry (spec 02 FR-12): at most one reply is generated per
 * session at a time. It lives in process memory, so it holds for ONE instance
 * only; with several instances a shared lock is needed (see AGENTS.md).
 *
 * It is also the `SessionGenerationCanceller`: ending or discarding a session
 * aborts its generation.
 */
export class GenerationRegistry implements SessionGenerationCanceller {
  private readonly active = new Map<string, AbortController>();

  /** Claims the session synchronously; null when a generation is running. */
  tryAcquire(sessionId: string): GenerationClaim | null {
    if (this.active.has(sessionId)) return null;
    const controller = new AbortController();
    this.active.set(sessionId, controller);
    let finished = false;
    const free = (): void => {
      if (this.active.get(sessionId) === controller) {
        this.active.delete(sessionId);
      }
    };
    return {
      signal: controller.signal,
      release: () => {
        if (finished) return;
        free();
        controller.abort();
      },
      finish: () => {
        finished = true;
        free();
      },
    };
  }

  isActive(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  cancel(sessionId: string): void {
    this.active.get(sessionId)?.abort();
  }
}
