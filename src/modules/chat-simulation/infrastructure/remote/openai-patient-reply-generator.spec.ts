import { ReplyGenerationFailedError } from '../../../../shared/domain-error';
import type { Message } from '../../domain/message';
import type {
  ReplyChunk,
  ReplyRequest,
} from '../../domain/patient-reply-generator';
import {
  FakeApiError,
  FakeOpenAiAgentsClient,
  events,
  type ScriptStep,
} from './fake-openai-agents-client';
import { formatTranscriptForReplay } from './format-transcript-for-replay';
import {
  OpenAiPatientReplyGenerator,
  type GeneratorLogger,
} from './openai-patient-reply-generator';
import { PATIENT_OPENING_INPUT } from './placeholder-prompts';

// Marker strings: none of them may ever reach a log line or an error.
const INPUT_MARKER = 'MARKER-THERAPIST-INPUT-7f3a';
const OUTPUT_MARKER = 'MARKER-PATIENT-OUTPUT-91bc';
const PROVIDER_MARKER = 'MARKER-PROVIDER-MESSAGE-5d2e';
const REMOTE_ID_MARKER = 'sess_MARKER-REMOTE-ID-c4a8';
const FORBIDDEN = [
  INPUT_MARKER,
  OUTPUT_MARKER,
  PROVIDER_MARKER,
  REMOTE_ID_MARKER,
];

class CapturingLogger implements GeneratorLogger {
  readonly lines: string[] = [];
  log(line: string) {
    this.lines.push(`LOG ${line}`);
  }
  warn(line: string) {
    this.lines.push(`WARN ${line}`);
  }
  error(line: string) {
    this.lines.push(`ERROR ${line}`);
  }
  text() {
    return this.lines.join('\n');
  }
}

function message(id: string, role: Message['role'], text: string): Message {
  return {
    id,
    sessionId: 'our-session',
    role,
    text,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function request(overrides: {
  session?: Partial<ReplyRequest['session']>;
  history?: Message[];
  pending?: Message | null;
}): ReplyRequest {
  return {
    session: {
      id: 'our-session',
      language: 'en',
      agentId: 'agent-for-case',
      openaiSessionId: null,
      remoteInSync: true,
      ...overrides.session,
    },
    history: overrides.history ?? [],
    pending: overrides.pending === undefined ? null : overrides.pending,
  };
}

const opening = () => request({});

async function run(
  generator: OpenAiPatientReplyGenerator,
  req: ReplyRequest,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ chunks: ReplyChunk[]; error: unknown }> {
  const chunks: ReplyChunk[] = [];
  try {
    for await (const chunk of generator.generate(req, signal))
      chunks.push(chunk);
  } catch (error) {
    return { chunks, error };
  }
  return { chunks, error: undefined };
}

describe('OpenAiPatientReplyGenerator', () => {
  let client: FakeOpenAiAgentsClient;
  let logger: CapturingLogger;
  let generator: OpenAiPatientReplyGenerator;

  beforeEach(() => {
    client = new FakeOpenAiAgentsClient();
    logger = new CapturingLogger();
    generator = new OpenAiPatientReplyGenerator(client, logger);
  });

  function script(...steps: ScriptStep[]) {
    client.startScripts.push(steps);
  }

  describe('events', () => {
    it('AC-1: yields remote-session before the first delta, then deltas, then completed', async () => {
      script(
        events.created('sess_1'),
        events.delta('Hel'),
        events.delta('lo'),
        events.done('Hello'),
        events.turn('completed'),
      );

      const { chunks, error } = await run(generator, opening());

      expect(error).toBeUndefined();
      expect(chunks).toEqual([
        { kind: 'remote-session', openaiSessionId: 'sess_1' },
        { kind: 'text', text: 'Hel' },
        { kind: 'text', text: 'lo' },
        { kind: 'completed' },
      ]);
    });

    it('announces the session id from the first event that carries one, even a text event', async () => {
      script(events.delta('Hi'), events.done('Hi'), events.turn('completed'));

      const { chunks } = await run(generator, opening());

      expect(chunks[0]).toEqual({
        kind: 'remote-session',
        openaiSessionId: 'sess_1',
      });
      expect(chunks[1]).toEqual({ kind: 'text', text: 'Hi' });
    });

    it('AC-2: yields the done text as one chunk when no deltas were seen', async () => {
      script(
        events.created('sess_1'),
        events.done('Hello'),
        events.turn('completed'),
      );

      const { chunks } = await run(generator, opening());

      expect(chunks).toEqual([
        { kind: 'remote-session', openaiSessionId: 'sess_1' },
        { kind: 'text', text: 'Hello' },
        { kind: 'completed' },
      ]);
    });

    it('AC-3: fails when the deltas differ from the done text', async () => {
      script(
        events.created('sess_1'),
        events.delta('Hel'),
        events.delta('lo'),
        events.done('Hello!'),
        events.turn('completed'),
      );

      const { chunks, error } = await run(generator, opening());

      expect(error).toBeInstanceOf(ReplyGenerationFailedError);
      expect(chunks.some((c) => c.kind === 'completed')).toBe(false);
      expect(logger.text()).toContain('stage=text_mismatch');
    });

    it('fails when a part has a done text that was never streamed while others were', async () => {
      script(
        events.created('sess_1'),
        events.delta('a', 'sess_1', 0, 0),
        events.done('a', 'sess_1', 0, 0),
        events.done('b', 'sess_1', 0, 1),
        events.turn('completed'),
      );

      const { error } = await run(generator, opening());

      expect(error).toBeInstanceOf(ReplyGenerationFailedError);
    });

    it('concatenates several done parts in (output_index, content_index) order', async () => {
      script(
        events.created('sess_1'),
        events.done('C', 'sess_1', 1, 0),
        events.done('B', 'sess_1', 0, 1),
        events.done('A', 'sess_1', 0, 0),
        events.turn('completed'),
      );

      const { chunks } = await run(generator, opening());

      expect(chunks[1]).toEqual({ kind: 'text', text: 'ABC' });
    });

    it('accepts streamed deltas of several parts when each matches its done text', async () => {
      script(
        events.created('sess_1'),
        events.delta('A', 'sess_1', 0, 0),
        events.delta('B', 'sess_1', 0, 1),
        events.done('A', 'sess_1', 0, 0),
        events.done('B', 'sess_1', 0, 1),
        events.turn('completed'),
      );

      const { chunks, error } = await run(generator, opening());

      expect(error).toBeUndefined();
      expect(chunks.map((c) => c.kind)).toEqual([
        'remote-session',
        'text',
        'text',
        'completed',
      ]);
    });

    it('ignores reasoning, item, usage, idle and subagent events', async () => {
      script(
        events.created('sess_1'),
        events.of('agent.session.turn.created'),
        events.of('agent.session.turn.reasoning_summary_text.delta'),
        events.of('agent.session.turn.item.added'),
        events.of('agent.session.subagent.created'),
        events.turn('completed', { subagentId: 'sub_1', turnId: 'turn_sub' }),
        events.turn('failed', { subagentId: 'sub_1', turnId: 'turn_sub' }),
        events.of('agent.session.idle'),
        events.delta('Hi'),
        events.done('Hi'),
        events.turn('completed'),
      );

      const { chunks, error } = await run(generator, opening());

      expect(error).toBeUndefined();
      expect(chunks.filter((c) => c.kind === 'text')).toEqual([
        { kind: 'text', text: 'Hi' },
      ]);
    });

    it('passes a reply longer than 2,500 characters through untouched (the application owns the bound)', async () => {
      const long = 'x'.repeat(2600);
      script(
        events.created('sess_1'),
        events.delta(long),
        events.done(long),
        events.turn('completed'),
      );

      const { chunks, error } = await run(generator, opening());

      expect(error).toBeUndefined();
      expect(chunks[1]).toEqual({ kind: 'text', text: long });
    });

    it('does not buffer: the first chunk is available before the stream ends', async () => {
      script(events.created('sess_1'), events.delta('first'), { stall: true });
      const abort = new AbortController();
      const iterator = generator.generate(opening(), abort.signal);

      await iterator.next();
      const text = await iterator.next();

      expect(text.value).toEqual({ kind: 'text', text: 'first' });
      abort.abort();
      await iterator.next();
    });

    it('logs time to first delta without any content', async () => {
      script(
        events.created('sess_1'),
        events.delta(OUTPUT_MARKER),
        events.done(OUTPUT_MARKER),
        events.turn('completed'),
      );

      await run(generator, opening());

      expect(logger.text()).toMatch(
        /event=reply_generated .*time_to_first_delta_ms=\d+/,
      );
    });
  });

  describe('which remote session is used (FR-2, FR-3)', () => {
    it('opening: creates a session for the stored agent with the placeholder opening input and no overrides', async () => {
      script(
        events.created('sess_1'),
        events.done('Hi'),
        events.turn('completed'),
      );

      await run(generator, request({ session: { language: 'ru' } }));

      expect(client.calls).toEqual([
        {
          op: 'start',
          agentId: 'agent-for-case',
          input: PATIENT_OPENING_INPUT.ru,
        },
      ]);
    });

    it('AC-7: reuses an in-sync session and sends only the pending text with a stable idempotency key', async () => {
      const pending = message('msg-9', 'THERAPIST', 'pending text');
      const req = request({
        session: { openaiSessionId: 'sess_1', remoteInSync: true },
        history: [
          message('m1', 'PATIENT', 'old patient'),
          message('m2', 'THERAPIST', 'old therapist'),
        ],
        pending,
      });
      client.continueScripts.push(
        [events.delta('Hi'), events.done('Hi'), events.turn('completed')],
        [events.delta('Hi'), events.done('Hi'), events.turn('completed')],
      );

      const first = await run(generator, req);
      await run(generator, req);

      expect(first.chunks.map((c) => c.kind)).toEqual(['text', 'completed']);
      expect(client.calls).toEqual([
        {
          op: 'continue',
          sessionId: 'sess_1',
          text: 'pending text',
          idempotencyKey: 'therapist-message-msg-9',
        },
        {
          op: 'continue',
          sessionId: 'sess_1',
          text: 'pending text',
          idempotencyKey: 'therapist-message-msg-9',
        },
      ]);
    });

    it('uses a different idempotency key for a different therapist message', async () => {
      client.continueScripts.push(
        [events.turn('completed')],
        [events.turn('completed')],
      );
      const base = { session: { openaiSessionId: 'sess_1' } };

      await run(
        generator,
        request({ ...base, pending: message('a', 'THERAPIST', 'x') }),
      );
      await run(
        generator,
        request({ ...base, pending: message('b', 'THERAPIST', 'x') }),
      );

      const keys = client.calls.map((c) => c.idempotencyKey);
      expect(keys[0]).not.toEqual(keys[1]);
    });

    it('AC-5: when out of sync, starts a new session and replays the transcript with the pending message once', async () => {
      const history = [
        message('m1', 'PATIENT', 'opening line'),
        message('m2', 'THERAPIST', 'earlier question'),
        message('m3', 'PATIENT', 'earlier answer'),
      ];
      const pending = message('m4', 'THERAPIST', INPUT_MARKER);
      script(
        events.created('sess_2'),
        events.done('Hi'),
        events.turn('completed'),
      );

      const { chunks } = await run(
        generator,
        request({
          session: { openaiSessionId: 'sess_old', remoteInSync: false },
          history,
          pending,
        }),
      );

      const start = client.calls[0];
      expect(client.calls).toHaveLength(1);
      expect(start.op).toBe('start');
      expect(start.input).toBe(
        formatTranscriptForReplay('en', history, pending),
      );
      expect((start.input as string).split(INPUT_MARKER)).toHaveLength(2);
      expect(chunks[0]).toEqual({
        kind: 'remote-session',
        openaiSessionId: 'sess_2',
      });
      expect(client.calls.some((c) => c.op === 'continue')).toBe(false);
    });

    it('starts a new session when messages exist but no remote session is stored', async () => {
      script(
        events.created('sess_2'),
        events.done('Hi'),
        events.turn('completed'),
      );
      const pending = message('m2', 'THERAPIST', 'hello');

      await run(
        generator,
        request({
          session: { openaiSessionId: null, remoteInSync: true },
          history: [message('m1', 'PATIENT', 'opening')],
          pending,
        }),
      );

      expect(client.calls[0].op).toBe('start');
    });

    it('a retried opening starts a new session even if an old remote id is stored', async () => {
      script(
        events.created('sess_2'),
        events.done('Hi'),
        events.turn('completed'),
      );

      const { chunks } = await run(
        generator,
        request({
          session: { openaiSessionId: 'sess_old', remoteInSync: false },
        }),
      );

      expect(client.calls[0].op).toBe('start');
      expect(chunks[0]).toEqual({
        kind: 'remote-session',
        openaiSessionId: 'sess_2',
      });
    });
  });

  describe('failures (AC-4, FR-8)', () => {
    const outcomes: Array<[string, ScriptStep[]]> = [
      [
        'turn.failed',
        [
          events.created('sess_1'),
          events.turn('failed', { code: 'server_error' }),
        ],
      ],
      ['turn.cancelled', [events.created('sess_1'), events.turn('cancelled')]],
      [
        'agent.session.failed',
        [events.created('sess_1'), events.of('agent.session.failed')],
      ],
      [
        'agent.session.environment.failed',
        [
          events.created('sess_1'),
          events.of('agent.session.environment.failed'),
        ],
      ],
      ['error event', [events.created('sess_1'), events.of('error')]],
      [
        'requires_action',
        [events.created('sess_1'), events.of('agent.session.requires_action')],
      ],
      [
        'stream ending early',
        [events.created('sess_1'), events.delta('partial')],
      ],
      ['stream ending immediately', []],
      [
        'stream error HTTP 429',
        [
          events.created('sess_1'),
          { throw: new FakeApiError(429, PROVIDER_MARKER, 'req_1') },
        ],
      ],
      [
        'stream error HTTP 500',
        [
          events.created('sess_1'),
          { throw: new FakeApiError(500, PROVIDER_MARKER) },
        ],
      ],
      [
        'network error',
        [
          events.created('sess_1'),
          { throw: new FakeApiError(undefined, PROVIDER_MARKER) },
        ],
      ],
      [
        'text before any session id',
        [{ ...events.delta('x'), session_id: undefined }],
      ],
    ];

    it.each(outcomes)(
      '%s fails as reply-generation-failed with no provider text',
      async (_name, steps) => {
        script(...steps);

        const { error } = await run(generator, opening());

        expect(error).toBeInstanceOf(ReplyGenerationFailedError);
        const shown = `${(error as Error).message}\n${logger.text()}`;
        expect(shown).not.toContain(PROVIDER_MARKER);
      },
    );

    it.each([429, 500, 503, undefined])(
      'a rejected start with status %p fails as reply-generation-failed',
      async (status) => {
        client.startError = new FakeApiError(status, PROVIDER_MARKER, 'req_9');

        const { chunks, error } = await run(generator, opening());

        expect(error).toBeInstanceOf(ReplyGenerationFailedError);
        expect(chunks).toEqual([]);
        expect(logger.text()).not.toContain(PROVIDER_MARKER);
        expect(logger.text()).toContain('stage=start');
      },
    );

    it('a rejected follow-up fails as reply-generation-failed', async () => {
      client.continueError = new FakeApiError(500, PROVIDER_MARKER);

      const { error } = await run(
        generator,
        request({
          session: { openaiSessionId: 'sess_1' },
          pending: message('m', 'THERAPIST', 'x'),
        }),
      );

      expect(error).toBeInstanceOf(ReplyGenerationFailedError);
      expect(logger.text()).not.toContain(PROVIDER_MARKER);
    });

    it('logs status and request id for an HTTP failure, not the message', async () => {
      client.startError = new FakeApiError(429, PROVIDER_MARKER, 'req_abc');

      await run(generator, opening());

      expect(logger.text()).toContain('http_status=429');
      expect(logger.text()).toContain('openai_request_id=req_abc');
      expect(logger.text()).toContain('error_class=FakeApiError');
    });

    it.each([401, 403])(
      'HTTP %i also logs openai_auth_failed',
      async (status) => {
        client.startError = new FakeApiError(status, PROVIDER_MARKER);

        const { error } = await run(generator, opening());

        expect(error).toBeInstanceOf(ReplyGenerationFailedError);
        expect(logger.text()).toContain('event=openai_auth_failed');
        expect(logger.text()).not.toContain(PROVIDER_MARKER);
      },
    );

    it('logs the provider error code of a failed turn only when it is a safe token', async () => {
      script(
        events.created('sess_1'),
        events.turn('failed', {
          code: `${PROVIDER_MARKER} free text with spaces`,
        }),
      );

      await run(generator, opening());

      expect(logger.text()).toContain('code=other');
      expect(logger.text()).not.toContain(PROVIDER_MARKER);
    });

    it('a failure that was not caused by an abort sends no cancel', async () => {
      script(events.created('sess_1'), events.turn('failed'));

      await run(generator, opening());

      expect(client.calls.some((c) => c.op === 'cancel')).toBe(false);
    });
  });

  describe('abort (AC-6, FR-5)', () => {
    it('mid-stream: the stream sees the abort, a cancel is attempted, the loop ends without throwing', async () => {
      script(events.created('sess_1'), events.delta('Hel'), { stall: true });
      const abort = new AbortController();
      const chunks: ReplyChunk[] = [];

      for await (const chunk of generator.generate(opening(), abort.signal)) {
        chunks.push(chunk);
        if (chunk.kind === 'text') abort.abort();
      }

      expect(chunks).toEqual([
        { kind: 'remote-session', openaiSessionId: 'sess_1' },
        { kind: 'text', text: 'Hel' },
      ]);
      expect(client.abortedStreams).toBe(1);
      expect(client.releasedStreams).toBe(1);
      expect(client.calls.filter((c) => c.op === 'cancel')).toEqual([
        { op: 'cancel', sessionId: 'sess_1' },
      ]);
    });

    it('a stalled stream ends on abort (the loop never outlives the signal)', async () => {
      script(events.created('sess_1'), { stall: true });
      const abort = new AbortController();
      const pending = run(generator, opening(), abort.signal);

      setTimeout(() => abort.abort(), 5);
      const { error } = await pending;

      expect(error).toBeUndefined();
      expect(client.calls.filter((c) => c.op === 'cancel')).toHaveLength(1);
    });

    it('a failing cancel does not throw', async () => {
      client.cancelError = new FakeApiError(500, PROVIDER_MARKER);
      script(events.created('sess_1'), { stall: true });
      const abort = new AbortController();
      const pending = run(generator, opening(), abort.signal);

      setTimeout(() => abort.abort(), 5);
      const { error } = await pending;

      expect(error).toBeUndefined();
      expect(logger.text()).toContain('event=openai_cancel_failed');
      expect(logger.text()).not.toContain(PROVIDER_MARKER);
    });

    it('cancels a reused session by its stored id', async () => {
      client.continueScripts.push([{ stall: true }]);
      const abort = new AbortController();
      const pending = run(
        generator,
        request({
          session: { openaiSessionId: 'sess_1' },
          pending: message('m', 'THERAPIST', 'x'),
        }),
        abort.signal,
      );

      setTimeout(() => abort.abort(), 5);
      await pending;

      expect(client.calls).toContainEqual({
        op: 'cancel',
        sessionId: 'sess_1',
      });
    });

    it('an abort before the session id is known sends no cancel', async () => {
      script({ stall: true });
      const abort = new AbortController();
      const pending = run(generator, opening(), abort.signal);

      setTimeout(() => abort.abort(), 5);
      await pending;

      expect(client.calls.some((c) => c.op === 'cancel')).toBe(false);
    });

    it('an abort while the start request is still pending ends promptly', async () => {
      client.startSession = () => new Promise(() => undefined);
      const abort = new AbortController();
      const pending = run(generator, opening(), abort.signal);

      setTimeout(() => abort.abort(), 5);

      await expect(pending).resolves.toEqual({ chunks: [], error: undefined });
    });

    it('an already aborted signal does nothing', async () => {
      const abort = new AbortController();
      abort.abort();

      const { chunks } = await run(generator, opening(), abort.signal);

      expect(chunks).toEqual([]);
      expect(client.calls).toEqual([]);
    });

    it('an abort after completed is ignored: no cancel', async () => {
      script(
        events.created('sess_1'),
        events.done('Hi'),
        events.turn('completed'),
      );
      const abort = new AbortController();
      const iterator = generator.generate(opening(), abort.signal);

      let last: ReplyChunk | undefined;
      for (;;) {
        const step = await iterator.next();
        if (step.done) break;
        last = step.value;
        if (step.value.kind === 'completed') abort.abort();
      }

      expect(last).toEqual({ kind: 'completed' });
      expect(client.calls.some((c) => c.op === 'cancel')).toBe(false);
    });

    it('releases the stream when the consumer stops early', async () => {
      script(
        events.created('sess_1'),
        events.delta('a'),
        events.delta('b'),
        events.turn('completed'),
      );
      const iterator = generator.generate(
        opening(),
        new AbortController().signal,
      );

      await iterator.next();
      await iterator.return(undefined);

      expect(client.releasedStreams).toBe(1);
    });
  });

  describe('AC-11: no content, provider text or remote ids in logs', () => {
    it('finds none of the markers across success, failure and abort', async () => {
      const markers = [
        // success
        () => {
          script(
            events.created(REMOTE_ID_MARKER),
            events.delta(OUTPUT_MARKER, REMOTE_ID_MARKER),
            events.done(OUTPUT_MARKER, REMOTE_ID_MARKER),
            events.turn('completed', { sessionId: REMOTE_ID_MARKER }),
          );
          return run(generator, request({}));
        },
        // mismatch
        () => {
          script(
            events.created(REMOTE_ID_MARKER),
            events.delta(OUTPUT_MARKER, REMOTE_ID_MARKER),
            events.done(`${OUTPUT_MARKER}!`, REMOTE_ID_MARKER),
            events.turn('completed', { sessionId: REMOTE_ID_MARKER }),
          );
          return run(generator, request({}));
        },
        // provider error mid-stream
        () => {
          script(events.created(REMOTE_ID_MARKER), {
            throw: new FakeApiError(
              500,
              `${PROVIDER_MARKER} ${INPUT_MARKER}`,
              'req_1',
            ),
          });
          return run(generator, request({}));
        },
        // replay with the therapist text in the input
        () => {
          script(events.created(REMOTE_ID_MARKER), events.turn('failed'));
          return run(
            generator,
            request({
              session: {
                openaiSessionId: REMOTE_ID_MARKER,
                remoteInSync: false,
              },
              history: [message('m1', 'PATIENT', OUTPUT_MARKER)],
              pending: message('m2', 'THERAPIST', INPUT_MARKER),
            }),
          );
        },
        // follow-up with an error
        () => {
          client.continueError = new FakeApiError(401, PROVIDER_MARKER);
          return run(
            generator,
            request({
              session: { openaiSessionId: REMOTE_ID_MARKER },
              pending: message('m3', 'THERAPIST', INPUT_MARKER),
            }),
          );
        },
        // abort with a failing cancel
        async () => {
          client.cancelError = new FakeApiError(500, PROVIDER_MARKER);
          client.startScripts.push([
            events.created(REMOTE_ID_MARKER),
            { stall: true },
          ]);
          const abort = new AbortController();
          const pending = run(generator, request({}), abort.signal);
          setTimeout(() => abort.abort(), 5);
          return pending;
        },
      ];

      for (const scenario of markers) {
        client.continueError = undefined;
        client.cancelError = undefined;
        await scenario();
      }

      expect(logger.lines.length).toBeGreaterThan(0);
      for (const marker of FORBIDDEN) {
        expect(logger.text()).not.toContain(marker);
      }
    });
  });
});
