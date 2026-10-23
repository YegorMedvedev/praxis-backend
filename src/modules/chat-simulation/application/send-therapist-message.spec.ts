import {
  InvalidRequestError,
  ReplyPendingError,
  SessionEndedError,
  SessionNotFoundError,
} from '../../../shared/domain-error';
import type { Message } from '../domain/message';
import { Session } from '../domain/session';
import {
  InMemoryMessageRepository,
  InMemorySessionRepository,
  InMemoryUnitOfWork,
} from './fakes';
import { ListMessages } from './list-messages';
import { SendTherapistMessage } from './send-therapist-message';

describe('therapist messages', () => {
  let now: Date;
  let nextId: number;
  let sessions: InMemorySessionRepository;
  let messages: InMemoryMessageRepository;
  let send: SendTherapistMessage;
  let list: ListMessages;

  const patient = (id: string): Message => ({
    id,
    sessionId: 's1',
    role: 'PATIENT',
    text: 'Hi.',
    createdAt: now,
  });

  beforeEach(async () => {
    now = new Date('2026-01-01T10:00:00.000Z');
    nextId = 0;
    sessions = new InMemorySessionRepository();
    messages = new InMemoryMessageRepository();
    const uow = new InMemoryUnitOfWork([sessions, messages]);
    send = new SendTherapistMessage(
      sessions,
      messages,
      uow,
      { next: () => `m${++nextId}` },
      { now: () => now },
    );
    list = new ListMessages(sessions, messages, { now: () => now });
    await sessions.insert(
      Session.start({
        id: 's1',
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
        agentId: 'agent',
        now,
      }),
    );
  });

  it('stores the trimmed text after the patient opening (AC-2)', async () => {
    await messages.append(patient('opening'));

    const message = await send.execute('u1', 's1', '  Hello  ');

    expect(message).toEqual({
      id: 'm1',
      sessionId: 's1',
      role: 'THERAPIST',
      text: 'Hello',
      createdAt: now,
    });
    expect(messages.all('s1')).toHaveLength(2);
  });

  it('counts characters, not UTF-16 units: 2000 emoji fit, 2001 do not', async () => {
    await messages.append(patient('opening'));
    await expect(
      send.execute('u1', 's1', '😀'.repeat(2000)),
    ).resolves.toBeDefined();
    await messages.append(patient('again'));

    await expect(
      send.execute('u1', 's1', '😀'.repeat(2001)),
    ).rejects.toMatchObject({ params: [{ name: 'text', reason: 'TOO_LONG' }] });
  });

  it.each([
    ['   ', 'TOO_SHORT'],
    ['', 'TOO_SHORT'],
    ['x'.repeat(2001), 'TOO_LONG'],
    [`a${'\u0000'}b`, 'INVALID_VALUE'],
  ])('rejects %j as invalid-request (%s)', async (text, reason) => {
    await messages.append(patient('opening'));

    const error = await send.execute('u1', 's1', text).catch((e) => e);

    expect(error).toBeInstanceOf(InvalidRequestError);
    expect(error.params).toEqual([{ name: 'text', reason }]);
    expect(messages.all('s1')).toHaveLength(1);
  });

  it('answers reply-pending on an empty session (the opening is pending)', async () => {
    await expect(send.execute('u1', 's1', 'Hi')).rejects.toBeInstanceOf(
      ReplyPendingError,
    );
  });

  it('answers reply-pending while the last therapist message is unanswered (AC-4)', async () => {
    await messages.append(patient('opening'));
    await send.execute('u1', 's1', 'one');

    await expect(send.execute('u1', 's1', 'two')).rejects.toBeInstanceOf(
      ReplyPendingError,
    );
    expect(messages.all('s1')).toHaveLength(2);
  });

  it('answers session-ended for an ended session, before anything else (AC-4)', async () => {
    const session = (await sessions.lockOwned('s1', 'u1'))!;
    session.endByTherapist(now);
    await sessions.save(session);

    await expect(send.execute('u1', 's1', 'Hi')).rejects.toBeInstanceOf(
      SessionEndedError,
    );
  });

  it('treats a foreign or unknown session as not found', async () => {
    await expect(send.execute('u2', 's1', 'Hi')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    await expect(send.execute('u1', 'nope', 'Hi')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    await expect(list.execute('u2', 's1')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  it('lists the transcript in stored order', async () => {
    await messages.append(patient('opening'));
    await send.execute('u1', 's1', 'Hello');

    const items = await list.execute('u1', 's1');

    expect(items.map((m) => [m.id, m.role])).toEqual([
      ['opening', 'PATIENT'],
      ['m1', 'THERAPIST'],
    ]);
  });

  it('treats a session older than the retention period as not found, even before the job ran (05 FR-6)', async () => {
    now = new Date('2026-04-02T10:00:00.000Z'); // 91 days after creation

    await expect(send.execute('u1', 's1', 'Hi')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    await expect(list.execute('u1', 's1')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });
});
