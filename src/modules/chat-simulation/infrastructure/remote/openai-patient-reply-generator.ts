import { Logger } from '@nestjs/common';
import { ReplyGenerationFailedError } from '../../../../shared/domain-error';
import type {
  PatientReplyGenerator,
  ReplyChunk,
  ReplyRequest,
} from '../../domain/patient-reply-generator';
import { formatTranscriptForReplay } from './format-transcript-for-replay';
import {
  errorClassOf,
  httpStatusOf,
  requestIdOf,
  type AgentEventStream,
  type AgentStreamEvent,
  type OpenAiAgentsClient,
} from './openai-agents-client';
import { PATIENT_OPENING_INPUT } from './placeholder-prompts';

/** Where logs go; tests capture it. Lines never carry content or provider text. */
export interface GeneratorLogger {
  log(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

type Plan =
  | { kind: 'reuse'; sessionId: string; text: string; idempotencyKey: string }
  | { kind: 'new'; input: string };

type Raced<T> = { aborted: true } | { aborted: false; value: T };

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;

function safeToken(value: unknown): string {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : 'other';
}

/** Resolves to `{ aborted: true }` as soon as the signal fires. */
function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<Raced<T>> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.resolve({ aborted: true });
  }
  return new Promise<Raced<T>>((resolve, reject) => {
    const onAbort = () => resolve({ aborted: true });
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve({ aborted: false, value });
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Port adapter over the OpenAI Agents API (spec 07). It only talks to the
 * model: persistence of `openai_session_id` / `remote_in_sync` and queueing a
 * replaced remote session for deletion belong to the application layer (see
 * the port). It yields `remote-session` before the first text of a new remote
 * session, maps stream events per spec 07, and honours the abort signal.
 *
 * Holds no per-process state besides the client. Never logs input, output,
 * replay text, provider messages, remote session ids or the API key.
 */
export class OpenAiPatientReplyGenerator implements PatientReplyGenerator {
  constructor(
    private readonly client: OpenAiAgentsClient,
    private readonly logger: GeneratorLogger = new Logger(
      OpenAiPatientReplyGenerator.name,
    ),
  ) {}

  async *generate(
    request: ReplyRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ReplyChunk> {
    const startedAt = Date.now();
    const plan = this.plan(request);
    const sessionLabel = request.session.id;
    const counts = new Map<string, number>();

    let remoteId = plan.kind === 'reuse' ? plan.sessionId : undefined;
    let announced = plan.kind === 'reuse';
    let completed = false;
    let sawDelta = false;
    let firstDeltaMs: number | undefined;
    const deltas = new Map<
      string,
      { output: number; content: number; text: string }
    >();
    const dones = new Map<
      string,
      { output: number; content: number; text: string }
    >();
    const subagentTurns = new Set<string>();
    let iterator: AsyncIterator<AgentStreamEvent> | undefined;

    const fail = (
      stage: string,
      error?: unknown,
      code?: string | null,
    ): ReplyGenerationFailedError => {
      const status = httpStatusOf(error);
      const parts = [
        `event=reply_generation_failed`,
        `session=${sessionLabel}`,
        `stage=${stage}`,
        `duration_ms=${Date.now() - startedAt}`,
        `events=${JSON.stringify(Object.fromEntries(counts))}`,
      ];
      if (error !== undefined) parts.push(`error_class=${errorClassOf(error)}`);
      if (status !== undefined) parts.push(`http_status=${status}`);
      const requestId = requestIdOf(error);
      if (requestId) parts.push(`openai_request_id=${requestId}`);
      if (code) parts.push(`code=${safeToken(code)}`);
      this.logger.warn(parts.join(' '));
      if (status === 401 || status === 403) {
        this.logger.error(
          `event=openai_auth_failed session=${sessionLabel} http_status=${status}`,
        );
      }
      return new ReplyGenerationFailedError('reply generation failed');
    };

    try {
      if (signal.aborted) return;

      let stream: AgentEventStream;
      try {
        if (plan.kind === 'reuse') {
          stream = this.client.continueSession({
            sessionId: plan.sessionId,
            text: plan.text,
            idempotencyKey: plan.idempotencyKey,
            signal,
          });
        } else {
          const started = await raceAbort(
            this.client.startSession({
              agentId: request.session.agentId,
              input: plan.input,
              signal,
            }),
            signal,
          );
          if (started.aborted) return;
          stream = started.value;
        }
        iterator = stream[Symbol.asyncIterator]();
      } catch (error) {
        if (signal.aborted) return;
        throw fail('start', error);
      }

      for (;;) {
        let step: Raced<IteratorResult<AgentStreamEvent>>;
        try {
          step = await raceAbort(iterator.next(), signal);
        } catch (error) {
          if (signal.aborted) return;
          throw fail('stream', error);
        }
        if (step.aborted) return;
        if (step.value.done) throw fail('stream_ended_early');
        const event = step.value.value;
        const type = safeToken(event.type);
        counts.set(type, (counts.get(type) ?? 0) + 1);

        const eventSessionId = event.session_id ?? event.session?.id;
        if (typeof eventSessionId === 'string' && eventSessionId.length > 0) {
          remoteId ??= eventSessionId;
          if (!announced) {
            announced = true;
            yield { kind: 'remote-session', openaiSessionId: eventSessionId };
          }
        }

        switch (event.type) {
          case 'agent.session.turn.output_text.delta': {
            if (event.turn_id && subagentTurns.has(event.turn_id)) break;
            if (typeof event.delta !== 'string' || event.delta === '') break;
            if (!announced) throw fail('missing_session_id');
            const key = `${event.output_index ?? 0}:${event.content_index ?? 0}`;
            const part = deltas.get(key) ?? {
              output: event.output_index ?? 0,
              content: event.content_index ?? 0,
              text: '',
            };
            part.text += event.delta;
            deltas.set(key, part);
            if (!sawDelta) {
              sawDelta = true;
              firstDeltaMs = Date.now() - startedAt;
            }
            yield { kind: 'text', text: event.delta };
            break;
          }
          case 'agent.session.turn.output_text.done': {
            if (event.turn_id && subagentTurns.has(event.turn_id)) break;
            if (typeof event.text !== 'string') break;
            const output = event.output_index ?? 0;
            const content = event.content_index ?? 0;
            dones.set(`${output}:${content}`, {
              output,
              content,
              text: event.text,
            });
            break;
          }
          case 'agent.session.turn.completed':
          case 'agent.session.turn.failed':
          case 'agent.session.turn.cancelled': {
            if (event.turn?.subagent_id) {
              if (event.turn_id) subagentTurns.add(event.turn_id);
              break;
            }
            if (event.type !== 'agent.session.turn.completed') {
              throw fail(type, undefined, event.turn?.error?.code);
            }
            const ordered = (
              parts: Map<
                string,
                { output: number; content: number; text: string }
              >,
            ) =>
              [...parts.values()].sort(
                (a, b) => a.output - b.output || a.content - b.content,
              );
            if (sawDelta) {
              for (const [key, done] of dones) {
                if ((deltas.get(key)?.text ?? '') !== done.text) {
                  throw fail('text_mismatch');
                }
              }
            } else {
              const text = ordered(dones)
                .map((part) => part.text)
                .join('');
              if (!announced && text !== '') throw fail('missing_session_id');
              if (text !== '') yield { kind: 'text', text };
            }
            completed = true;
            this.logger.log(
              [
                `event=reply_generated`,
                `session=${sessionLabel}`,
                `duration_ms=${Date.now() - startedAt}`,
                `time_to_first_delta_ms=${firstDeltaMs ?? 'none'}`,
                `events=${JSON.stringify(Object.fromEntries(counts))}`,
              ].join(' '),
            );
            yield { kind: 'completed' };
            return;
          }
          case 'agent.session.failed':
          case 'agent.session.environment.failed':
          case 'error':
            throw fail(type, undefined, event.error?.code);
          case 'agent.session.requires_action':
            throw fail(type);
          default:
            break;
        }
      }
    } finally {
      if (iterator) {
        try {
          Promise.resolve(iterator.return?.()).catch(() => undefined);
        } catch {
          // best effort: releasing the stream must never throw
        }
      }
      if (!completed && signal.aborted && remoteId) {
        await this.cancel(remoteId, sessionLabel);
      }
    }
  }

  private plan(request: ReplyRequest): Plan {
    const { session, history, pending } = request;
    if (pending === null && history.length === 0) {
      return { kind: 'new', input: PATIENT_OPENING_INPUT[session.language] };
    }
    if (pending !== null && session.remoteInSync && session.openaiSessionId) {
      return {
        kind: 'reuse',
        sessionId: session.openaiSessionId,
        text: pending.text,
        // Stable across retries of the same therapist message.
        idempotencyKey: `therapist-message-${pending.id}`,
      };
    }
    return {
      kind: 'new',
      input: formatTranscriptForReplay(session.language, history, pending),
    };
  }

  /** Best effort; never throws, logs the error class only. */
  private async cancel(remoteId: string, sessionLabel: string): Promise<void> {
    try {
      await this.client.cancelTurn(remoteId);
    } catch (error) {
      const status = httpStatusOf(error);
      this.logger.warn(
        `event=openai_cancel_failed session=${sessionLabel} error_class=${errorClassOf(error)}` +
          (status === undefined ? '' : ` http_status=${status}`),
      );
    }
  }
}
