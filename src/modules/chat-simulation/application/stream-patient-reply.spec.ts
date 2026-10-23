import {
  NoReplyPendingError,
  ReplyGenerationFailedError,
  ReplyPendingError,
  ServiceUnavailableError,
  SessionEndedError,
  SessionNotFoundError,
} from '../../../shared/domain-error';
import type { Message } from '../domain/message';
import { Session } from '../domain/session';
import {
  FakePatientReplyGenerator,
  InMemoryDeletionQueue,
  InMemoryMessageRepository,
  InMemorySessionRepository,
  InMemoryUnitOfWork,
} from './fakes';
import { GenerationRegistry } from './generation-registry';
import {
  DEFAULT_REPLY_TIMINGS,
  StreamPatientReply,
  type PatientReplyStream,
  type ReplyStreamEvent,
} from './stream-patient-reply';

const types = (events: ReplyStreamEvent[]) => events.map((e) => e.type);

describe('StreamPatientReply', () => {
  let now: Date;
  let nextId: number;
  let sessions: InMemorySessionRepository;
  let messages: InMemoryMessageRepository;
  let queue: InMemoryDeletionQueue;
  let generator: FakePatientReplyGenerator;
  let registry: GenerationRegistry;
  let stream: StreamPatientReply;

  const build = (idleTimeoutMs = 60, keepAliveMs = 20) =>
    new StreamPatientReply(
      sessions,
      messages,
      generator,
      registry,
      queue,
      new InMemoryUnitOfWork([sessions, messages, queue]),
      { next: () => `id${++nextId}` },
      { now: () => now },
      { idleTimeoutMs, keepAliveMs },
    );

  const collect = async (run: PatientReplyStream) => {
    const events: ReplyStreamEvent[] = [];
    for await (const event of run.events) events.push(event);
    return events;
  };
  const request = async (userId = 'u1', sessionId = 's1') =>
    collect(await stream.execute(userId, sessionId));

  const therapist = (id: string, text = 'How are you?'): Message => ({
    id,
    sessionId: 's1',
    role: 'THERAPIST',
    text,
    createdAt: now,
  });
  const patient = (id: string, text = 'Fine.'): Message => ({
    id,
    sessionId: 's1',
    role: 'PATIENT',
    text,
    createdAt: now,
  });
  const stored = (sessionId = 's1') => sessions.sessions.get(sessionId)!;

  beforeEach(async () => {
    now = new Date('2026-01-01T10:00:00.000Z');
    nextId = 0;
    sessions = new InMemorySessionRepository();
    messages = new InMemoryMessageRepository();
    queue = new InMemoryDeletionQueue();
    generator = new FakePatientReplyGenerator();
    registry = new GenerationRegistry();
    stream = build();
    await sessions.insert(
      Session.start({
        id: 's1',
        userId: 'u1',
        caseId: 'c1',
        language: 'ru',
        agentId: 'agent-ru',
        now,
      }),
    );
  });

  describe('successful replies', () => {
    it('streams started, deltas in index order, completed; stores the opening (AC-1, AC-3)', async () => {
      generator.enqueue(FakePatientReplyGenerator.success('Hel', 'lo', '!'));

      const events = await request();

      expect(types(events)).toEqual([
        'started',
        'delta',
        'delta',
        'delta',
        'completed',
      ]);
      expect(events[0]).toEqual({ type: 'started', messageId: 'id1' });
      const deltas = events.filter((e) => e.type === 'delta');
      expect(deltas.map((d) => d.index)).toEqual([0, 1, 2]);
      expect(deltas.every((d) => d.messageId === 'id1')).toBe(true);
      const completed = events.at(-1) as Extract<
        ReplyStreamEvent,
        { type: 'completed' }
      >;
      expect(completed.message).toEqual({
        id: 'id1',
        sessionId: 's1',
        role: 'PATIENT',
        text: 'Hello!',
        createdAt: now,
      });
      expect(deltas.map((d) => d.text).join('')).toBe(completed.message.text);
      expect(messages.all('s1')).toEqual([completed.message]);
      expect(registry.isActive('s1')).toBe(false);
    });

    it('hands the generator the session, the transcript before the pending message and the pending message', async () => {
      await messages.append(patient('p0', 'Opening.'));
      await messages.append(therapist('t1', 'Question'));

      await request();

      const [call] = generator.requests;
      expect(call.session).toEqual({
        id: 's1',
        language: 'ru',
        agentId: 'agent-ru',
        openaiSessionId: null,
        remoteInSync: true,
      });
      expect(call.history.map((m) => m.id)).toEqual(['p0']);
      expect(call.pending?.id).toBe('t1');
    });

    it('passes a null pending message and empty history for the opening', async () => {
      await request();

      expect(generator.requests[0].pending).toBeNull();
      expect(generator.requests[0].history).toEqual([]);
    });

    it('is not an empty reply: whitespace only fails', async () => {
      generator.enqueue(FakePatientReplyGenerator.success('  ', '\n'));

      const events = await request();

      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'reply-generation-failed',
      });
      expect(messages.all('s1')).toEqual([]);
    });
  });

  describe('rejections before the stream starts', () => {
    it('answers no-reply-pending when the last message is the patient (AC-6)', async () => {
      await messages.append(patient('p0'));

      await expect(stream.execute('u1', 's1')).rejects.toBeInstanceOf(
        NoReplyPendingError,
      );
      expect(registry.isActive('s1')).toBe(false);
      expect(generator.started).toBe(0);
    });

    it('answers session-ended and session-not-found (AC-4)', async () => {
      await expect(stream.execute('u2', 's1')).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
      await expect(stream.execute('u1', 'nope')).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
      const session = (await sessions.lockOwned('s1', 'u1'))!;
      session.endByTherapist(now);
      await sessions.save(session);

      await expect(stream.execute('u1', 's1')).rejects.toBeInstanceOf(
        SessionEndedError,
      );
    });

    it('does not let a foreign user probe a running generation', async () => {
      const run = await stream.execute('u1', 's1');

      await expect(stream.execute('u2', 's1')).rejects.toBeInstanceOf(
        SessionNotFoundError,
      );
      run.close();
    });
  });

  describe('single-flight (AC-17)', () => {
    it('lets exactly one of two concurrent requests stream, then accepts a new one', async () => {
      generator.enqueue({
        steps: [
          { type: 'wait', ms: 30 },
          { type: 'text', text: 'First' },
        ],
      });

      const results = await Promise.allSettled([
        stream.execute('u1', 's1'),
        stream.execute('u1', 's1'),
      ]);

      const accepted = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        ReplyPendingError,
      );
      const events = await collect(
        (accepted[0] as PromiseFulfilledResult<PatientReplyStream>).value,
      );
      expect(events.at(-1)?.type).toBe('completed');
      expect(generator.started).toBe(1);

      // The opening is answered now, so a new request is "nothing pending",
      // not "busy": the slot was released.
      await expect(stream.execute('u1', 's1')).rejects.toBeInstanceOf(
        NoReplyPendingError,
      );
    });

    it('frees the slot when the request is rejected after claiming it', async () => {
      await messages.append(patient('p0'));
      await stream.execute('u1', 's1').catch(() => undefined);

      expect(registry.isActive('s1')).toBe(false);
    });

    it('keeps other sessions independent', async () => {
      await sessions.insert(
        Session.start({
          id: 's2',
          userId: 'u1',
          caseId: 'c2',
          language: 'en',
          agentId: 'a2',
          now,
        }),
      );
      const first = await stream.execute('u1', 's1');
      const second = await stream.execute('u1', 's2');

      expect(types(await collect(first))).toContain('completed');
      expect(types(await collect(second))).toContain('completed');
    });
  });

  describe('failures store nothing (AC-9, AC-15, AC-18)', () => {
    it('reports a failure after some deltas, keeps the therapist message and retries cleanly', async () => {
      await messages.append(patient('p0', 'Opening.'));
      await messages.append(therapist('t1'));
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(
          ['Par', 'tial'],
          new ReplyGenerationFailedError('provider said: SECRET-PROVIDER-TEXT'),
        ),
        FakePatientReplyGenerator.success('Whole', ' answer'),
      );

      const failed = await request();

      expect(types(failed)).toEqual(['started', 'delta', 'delta', 'error']);
      expect(failed.at(-1)).toEqual({
        type: 'error',
        code: 'reply-generation-failed',
        errorClass: 'ReplyGenerationFailedError',
      });
      expect(JSON.stringify(failed)).not.toContain('SECRET-PROVIDER-TEXT');
      expect(messages.all('s1').map((m) => m.id)).toEqual(['p0', 't1']);
      expect(registry.isActive('s1')).toBe(false);

      const retried = await request();

      expect(types(retried).at(-1)).toBe('completed');
      const all = messages.all('s1');
      expect(all.map((m) => m.role)).toEqual([
        'PATIENT',
        'THERAPIST',
        'PATIENT',
      ]);
      expect(all[2].text).toBe('Whole answer');
      expect(generator.requests[1].pending?.id).toBe('t1');
    });

    it('maps an unexpected error to a generic failure, naming only its class', async () => {
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(
          [],
          new TypeError('prompt leaked: MARKER'),
        ),
      );

      const events = await request();

      expect(events.at(-1)).toEqual({
        type: 'error',
        code: 'reply-generation-failed',
        errorClass: 'TypeError',
      });
      expect(JSON.stringify(events)).not.toContain('MARKER');
    });

    it('reports a down dependency as service-unavailable', async () => {
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(
          [],
          new ServiceUnavailableError('down'),
        ),
      );

      const events = await request();

      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'service-unavailable',
      });
    });

    it('fails when the generator ends without the completion marker', async () => {
      generator.enqueue({
        steps: [{ type: 'text', text: 'cut' }],
        complete: false,
      });

      const events = await request();

      expect(events.at(-1)).toMatchObject({ type: 'error' });
      expect(messages.all('s1')).toEqual([]);
    });

    it('fails when storing the reply fails, and stores nothing', async () => {
      messages.failAppendWith = new Error('db down: SQL MARKER');

      const events = await request();

      expect(events.at(-1)).toEqual({
        type: 'error',
        code: 'reply-generation-failed',
        errorClass: 'Error',
      });
      messages.failAppendWith = null;
      expect(messages.all('s1')).toEqual([]);
    });
  });

  describe('reply length (AC-11)', () => {
    it('stores exactly 2,500 characters', async () => {
      generator.enqueue(FakePatientReplyGenerator.success('a'.repeat(2500)));

      const events = await request();

      expect(events.at(-1)?.type).toBe('completed');
      expect(messages.all('s1')[0].text).toHaveLength(2500);
    });

    it('fails on 2,501 characters, split across deltas, and stores nothing', async () => {
      generator.enqueue(
        FakePatientReplyGenerator.success('a'.repeat(1500), 'b'.repeat(1001)),
      );

      const events = await request();

      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'reply-generation-failed',
      });
      expect(types(events)).not.toContain('completed');
      expect(messages.all('s1')).toEqual([]);
    });

    it('counts code points: 2,500 emoji are fine, even split between deltas', async () => {
      generator.enqueue(
        FakePatientReplyGenerator.success('😀'.repeat(1250), '😀'.repeat(1250)),
      );

      const events = await request();

      expect(events.at(-1)?.type).toBe('completed');
    });

    it('rejects a NUL character, which cannot be stored', async () => {
      generator.enqueue(FakePatientReplyGenerator.success('a\u0000b'));

      const events = await request();

      expect(events.at(-1)).toMatchObject({ type: 'error' });
      expect(messages.all('s1')).toEqual([]);
    });
  });

  describe('time-outs and keep-alive (AC-10)', () => {
    it('fails when nothing arrives within the idle limit after started', async () => {
      generator.enqueue({ steps: [{ type: 'stall' }] });

      const events = await request();

      expect(events.at(-1)).toEqual({
        type: 'error',
        code: 'reply-generation-failed',
        errorClass: 'ReplyTimeout',
      });
      expect(generator.aborted).toBe(1);
      expect(messages.all('s1')).toEqual([]);
    });

    it('fails when progress stops mid-reply', async () => {
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Start'));

      const events = await request();

      expect(types(events).filter((t) => t !== 'keep-alive')).toEqual([
        'started',
        'delta',
        'error',
      ]);
    });

    it('sends keep-alives while a slow generation runs, then completes', async () => {
      stream = build(500, 20);
      generator.enqueue({
        steps: [
          { type: 'wait', ms: 90 },
          { type: 'text', text: 'Slow' },
        ],
      });

      const events = await request();

      const alive = events.filter((e) => e.type === 'keep-alive').length;
      expect(alive).toBeGreaterThanOrEqual(2);
      expect(types(events).slice(-2)).toEqual(['delta', 'completed']);
    });

    it('does not time out while deltas keep arriving', async () => {
      stream = build(60, 1000);
      generator.enqueue({
        steps: [
          { type: 'wait', ms: 35 },
          { type: 'text', text: 'a' },
          { type: 'wait', ms: 35 },
          { type: 'text', text: 'b' },
          { type: 'wait', ms: 35 },
          { type: 'text', text: 'c' },
        ],
      });

      const events = await request();

      expect(events.at(-1)?.type).toBe('completed');
    });
  });

  describe('cancellation stores nothing (AC-8, AC-13)', () => {
    it('stops on close, stores nothing and lets a new generation start', async () => {
      await messages.append(patient('p0'));
      await messages.append(therapist('t1'));
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Par'));
      const run = await stream.execute('u1', 's1');
      const iterator = run.events[Symbol.asyncIterator]();
      expect((await iterator.next()).value.type).toBe('started');
      expect((await iterator.next()).value.type).toBe('delta');

      const pendingNext = iterator.next();
      run.close();

      expect(await pendingNext).toEqual({ value: undefined, done: true });
      expect(generator.aborted).toBe(1);
      expect(messages.all('s1').map((m) => m.id)).toEqual(['p0', 't1']);
      expect(registry.isActive('s1')).toBe(false);

      const again = await request();
      expect(types(again).at(-1)).toBe('completed');
      expect(
        messages.all('s1').filter((m) => m.role === 'PATIENT'),
      ).toHaveLength(2);
    });

    it('releases the slot when closed before the first event is read', async () => {
      const run = await stream.execute('u1', 's1');
      run.close();

      expect(registry.isActive('s1')).toBe(false);
      expect(await collect(run)).toEqual([]);
      expect(generator.started).toBe(0);
    });

    it('stops without an event when the session is cancelled (ended or discarded)', async () => {
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Par'));
      const run = await stream.execute('u1', 's1');
      const collected = collect(run);
      await new Promise((r) => setTimeout(r, 10));

      registry.cancel('s1');

      const events = await collected;
      expect(types(events)).toEqual(['started', 'delta']);
      expect(messages.all('s1')).toEqual([]);
      expect(generator.aborted).toBe(1);
    });

    it('stores nothing when the session ended while the generator was finishing', async () => {
      generator.enqueue({
        steps: [
          { type: 'text', text: 'Late' },
          { type: 'wait', ms: 20 },
        ],
      });
      const run = await stream.execute('u1', 's1');
      const collected = collect(run);
      await new Promise((r) => setTimeout(r, 5));
      // The end commits before the cancel signal reaches the registry.
      const session = (await sessions.lockOwned('s1', 'u1'))!;
      session.endByTherapist(now);
      await sessions.save(session);

      const events = await collected;

      expect(types(events)).not.toContain('completed');
      expect(messages.all('s1')).toEqual([]);
    });

    it('stores nothing when the session was discarded mid-generation', async () => {
      generator.enqueue({
        steps: [
          { type: 'text', text: 'Late' },
          { type: 'wait', ms: 20 },
        ],
      });
      const run = await stream.execute('u1', 's1');
      const collected = collect(run);
      await new Promise((r) => setTimeout(r, 5));
      await sessions.deleteOwned('s1', 'u1');

      const events = await collected;

      expect(types(events)).not.toContain('completed');
      expect(messages.all('s1')).toEqual([]);
    });
  });

  describe('remote conversation state', () => {
    it('persists the remote session id as soon as it is yielded, before any text is forwarded', async () => {
      generator.enqueue({
        steps: [
          { type: 'remote-session', openaiSessionId: 'remote-1' },
          { type: 'text', text: 'Hi' },
        ],
      });
      const run = await stream.execute('u1', 's1');
      const iterator = run.events[Symbol.asyncIterator]();
      await iterator.next(); // started
      const delta = await iterator.next();

      expect(delta.value.type).toBe('delta');
      expect(stored().openaiSessionId).toBe('remote-1');
      await iterator.return?.(undefined);
    });

    it('marks the remote session out of sync until a reply is stored (spec 07 rule 4)', async () => {
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(['x']),
        FakePatientReplyGenerator.success('ok'),
      );

      await request();
      expect(stored().remoteInSync).toBe(false);

      await request();
      expect(generator.requests[1].session.remoteInSync).toBe(false);
      expect(stored().remoteInSync).toBe(true);
    });

    it('stays out of sync after a cancel and after a time-out', async () => {
      generator.enqueue({ steps: [{ type: 'stall' }] });
      await request();
      expect(stored().remoteInSync).toBe(false);

      generator.enqueue(FakePatientReplyGenerator.stallAfter('x'));
      const run = await stream.execute('u1', 's1');
      const collected = collect(run);
      await new Promise((r) => setTimeout(r, 5));
      run.close();
      await collected;

      expect(stored().remoteInSync).toBe(false);
    });

    it('queues the replaced remote session for deletion and keeps the new id', async () => {
      const session = (await sessions.lockOwned('s1', 'u1'))!;
      session.attachRemoteSession('remote-old');
      await sessions.save(session);
      generator.enqueue({
        steps: [
          { type: 'remote-session', openaiSessionId: 'remote-new' },
          { type: 'text', text: 'Hi' },
        ],
      });

      await request();

      expect(generator.requests[0].session.openaiSessionId).toBe('remote-old');
      expect([...queue.entries.keys()]).toEqual(['remote-old']);
      expect(stored().openaiSessionId).toBe('remote-new');
    });

    it('does not queue anything when the same remote session is reused', async () => {
      const session = (await sessions.lockOwned('s1', 'u1'))!;
      session.attachRemoteSession('remote-1');
      await sessions.save(session);
      generator.enqueue({
        steps: [
          { type: 'remote-session', openaiSessionId: 'remote-1' },
          { type: 'text', text: 'Hi' },
        ],
      });

      await request();

      expect(queue.entries.size).toBe(0);
    });

    it('queues a remote session created for a session that has since been discarded', async () => {
      generator.enqueue({
        steps: [
          { type: 'wait', ms: 10 },
          { type: 'remote-session', openaiSessionId: 'remote-orphan' },
          { type: 'text', text: 'Hi' },
        ],
      });
      const run = await stream.execute('u1', 's1');
      const collected = collect(run);
      await sessions.deleteOwned('s1', 'u1');

      const events = await collected;

      expect(types(events)).not.toContain('completed');
      expect([...queue.entries.keys()]).toEqual(['remote-orphan']);
    });
  });

  describe('review fixes', () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** A generator that ignores the abort signal and announces a remote session late. */
    const lateRemote = (ms: number) =>
      ({
        async *generate() {
          await delay(ms);
          yield { kind: 'remote-session' as const, openaiSessionId: 'late' };
          yield { kind: 'text' as const, text: 'x' };
          yield { kind: 'completed' as const };
        },
      }) as unknown as FakePatientReplyGenerator;

    const withGenerator = (g: FakePatientReplyGenerator, idle = 60) => {
      generator = g;
      stream = build(idle, 20);
    };

    it('queues a remote session announced after the abort won the race', async () => {
      withGenerator(lateRemote(60));
      const run = await stream.execute('u1', 's1');
      const collected = collect(run);
      await delay(10);

      run.close();
      await collected;
      await delay(120);

      expect([...queue.entries.keys()]).toEqual(['late']);
      expect(messages.all('s1')).toEqual([]);
    });

    it('queues a remote session announced after the idle time-out', async () => {
      withGenerator(lateRemote(150), 40);

      const events = await request();

      expect(events.at(-1)).toMatchObject({ type: 'error' });
      await delay(200);
      expect([...queue.entries.keys()]).toEqual(['late']);
    });

    it('queues the new remote session when persisting it fails', async () => {
      generator.enqueue({
        steps: [
          { type: 'remote-session', openaiSessionId: 'remote-x' },
          { type: 'text', text: 'Hi' },
        ],
      });
      const original = sessions.lockOwned.bind(sessions);
      let calls = 0;
      jest.spyOn(sessions, 'lockOwned').mockImplementation((id, user) => {
        calls += 1;
        return calls === 2
          ? Promise.reject(new Error('db down'))
          : original(id, user);
      });

      const events = await request();

      expect(events.at(-1)).toMatchObject({
        type: 'error',
        code: 'reply-generation-failed',
      });
      expect([...queue.entries.keys()]).toEqual(['remote-x']);
    });

    it('does not abort the signal after a successful reply', async () => {
      let seen: AbortSignal | undefined;
      generator = {
        async *generate(_request: unknown, signal: AbortSignal) {
          seen = signal;
          yield { kind: 'text' as const, text: 'ok' };
          yield { kind: 'completed' as const };
        },
      } as unknown as FakePatientReplyGenerator;
      stream = build();

      const events = await request();

      expect(events.at(-1)?.type).toBe('completed');
      expect(seen?.aborted).toBe(false);
      expect(registry.isActive('s1')).toBe(false);
    });

    it('frees the slot before an error event is delivered', async () => {
      generator.enqueue(FakePatientReplyGenerator.failAfter(['a']));
      const run = await stream.execute('u1', 's1');
      let activeAtError: boolean | undefined;

      for await (const event of run.events) {
        if (event.type === 'error') activeAtError = registry.isActive('s1');
      }

      expect(activeAtError).toBe(false);
    });

    it('frees the slot when the message id cannot be generated', async () => {
      const broken = new StreamPatientReply(
        sessions,
        messages,
        generator,
        registry,
        queue,
        new InMemoryUnitOfWork([sessions, messages, queue]),
        {
          next: () => {
            throw new Error('ids down');
          },
        },
        { now: () => now },
      );

      await expect(broken.execute('u1', 's1')).rejects.toThrow('ids down');

      expect(registry.isActive('s1')).toBe(false);
    });

    it('sends keep-alives before the idle limit by default', () => {
      expect(DEFAULT_REPLY_TIMINGS.keepAliveMs).toBeLessThan(
        DEFAULT_REPLY_TIMINGS.idleTimeoutMs,
      );
    });
  });
});
