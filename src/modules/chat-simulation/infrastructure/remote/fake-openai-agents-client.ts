import type {
  AgentEventStream,
  AgentStreamEvent,
  OpenAiAgentsClient,
} from './openai-agents-client';

/** An error shaped like the SDK's `APIError` (status, request id, message). */
export class FakeApiError extends Error {
  constructor(
    readonly status: number | undefined,
    message = 'provider message',
    readonly requestID: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'FakeApiError';
  }
}

/** One scripted step of a stream. */
export type ScriptStep =
  | AgentStreamEvent
  | { throw: Error }
  /** Never yields again; ends only when the signal aborts. */
  | { stall: true };

/** Builders for the events of spec 07's mapping table. */
export const events = {
  created: (id: string): AgentStreamEvent => ({
    type: 'agent.session.created',
    session: { id },
  }),
  delta: (
    delta: string,
    sessionId = 'sess_1',
    output = 0,
    content = 0,
  ): AgentStreamEvent => ({
    type: 'agent.session.turn.output_text.delta',
    session_id: sessionId,
    delta,
    output_index: output,
    content_index: content,
    turn_id: 'turn_1',
  }),
  done: (
    text: string,
    sessionId = 'sess_1',
    output = 0,
    content = 0,
  ): AgentStreamEvent => ({
    type: 'agent.session.turn.output_text.done',
    session_id: sessionId,
    text,
    output_index: output,
    content_index: content,
    turn_id: 'turn_1',
  }),
  turn: (
    outcome: 'completed' | 'failed' | 'cancelled',
    options: {
      sessionId?: string;
      subagentId?: string | null;
      code?: string;
      turnId?: string;
    } = {},
  ): AgentStreamEvent => ({
    type: `agent.session.turn.${outcome}`,
    session_id: options.sessionId ?? 'sess_1',
    turn_id: options.turnId ?? 'turn_1',
    turn: {
      subagent_id: options.subagentId ?? null,
      error: options.code ? { code: options.code } : null,
    },
  }),
  of: (type: string, sessionId = 'sess_1'): AgentStreamEvent => ({
    type,
    session_id: sessionId,
  }),
};

export interface RecordedCall {
  op: 'start' | 'continue' | 'cancel' | 'delete';
  [key: string]: unknown;
}

/**
 * Fake of the OpenAI client interface. Scripts are consumed in order, one per
 * `startSession` / `continueSession` call. Everything observable is recorded.
 */
export class FakeOpenAiAgentsClient implements OpenAiAgentsClient {
  readonly calls: RecordedCall[] = [];
  /** Streams whose signal fired while they were still open. */
  abortedStreams = 0;
  /** True when the iterator was released (return() called). */
  releasedStreams = 0;
  startScripts: ScriptStep[][] = [];
  continueScripts: ScriptStep[][] = [];
  startError: Error | undefined;
  continueError: Error | undefined;
  cancelError: Error | undefined;
  deleteError: Error | undefined;

  startSession(request: {
    agentId: string;
    input: string;
    signal: AbortSignal;
  }): Promise<AgentEventStream> {
    this.calls.push({
      op: 'start',
      agentId: request.agentId,
      input: request.input,
    });
    if (this.startError) return Promise.reject(this.startError);
    return Promise.resolve(
      this.stream(this.startScripts.shift(), request.signal),
    );
  }

  continueSession(request: {
    sessionId: string;
    text: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): AgentEventStream {
    this.calls.push({
      op: 'continue',
      sessionId: request.sessionId,
      text: request.text,
      idempotencyKey: request.idempotencyKey,
    });
    if (this.continueError) {
      const error = this.continueError;
      // eslint-disable-next-line require-yield
      return (async function* (): AsyncGenerator<AgentStreamEvent> {
        await Promise.resolve();
        throw error;
      })();
    }
    return this.stream(this.continueScripts.shift(), request.signal);
  }

  cancelTurn(sessionId: string): Promise<void> {
    this.calls.push({ op: 'cancel', sessionId });
    return this.cancelError
      ? Promise.reject(this.cancelError)
      : Promise.resolve();
  }

  deleteSession(sessionId: string): Promise<void> {
    this.calls.push({ op: 'delete', sessionId });
    return this.deleteError
      ? Promise.reject(this.deleteError)
      : Promise.resolve();
  }

  private stream(
    script: ScriptStep[] | undefined,
    signal: AbortSignal,
  ): AgentEventStream {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fake = this;
    const steps = script ?? [];
    return (async function* (): AsyncGenerator<AgentStreamEvent> {
      const onAbort = () => {
        fake.abortedStreams += 1;
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        for (const step of steps) {
          await Promise.resolve();
          if ('throw' in step) throw step.throw;
          if ('stall' in step) {
            await new Promise<void>((resolve) => {
              if (signal.aborted) return resolve();
              signal.addEventListener('abort', () => resolve(), { once: true });
            });
            return;
          }
          yield step;
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        fake.releasedStreams += 1;
      }
    })();
  }
}
