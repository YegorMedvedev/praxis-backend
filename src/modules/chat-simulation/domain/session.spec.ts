import { SessionEndedError } from '../../../shared/domain-error';
import { Session } from './session';

const t0 = new Date('2026-01-01T10:00:00.000Z');

const start = () =>
  Session.start({
    id: 's1',
    userId: 'u1',
    caseId: 'c1',
    language: 'ru',
    agentId: 'agent-x',
    now: t0,
  });

describe('Session', () => {
  it('starts in progress with no end and a pristine remote state', () => {
    const session = start();
    expect(session.status).toBe('IN_PROGRESS');
    expect(session.endedAt).toBeNull();
    expect(session.durationSeconds()).toBeNull();
    expect(session.endedBy()).toBeNull();
    expect(session.openaiSessionId).toBeNull();
    expect(session.remoteInSync).toBe(true);
  });

  it('ends by the therapist once, rounding the duration down', () => {
    const session = start();
    const end = new Date(t0.getTime() + 125_700);

    expect(session.endByTherapist(end)).toBe(true);

    expect(session.status).toBe('ENDED_BY_THERAPIST');
    expect(session.endedAt).toEqual(end);
    expect(session.endedBy()).toBe('THERAPIST');
    expect(session.durationSeconds()).toBe(125);
  });

  it('is idempotent once ended by the therapist: nothing changes', () => {
    const session = start();
    const first = new Date(t0.getTime() + 1000);
    session.endByTherapist(first);

    expect(session.endByTherapist(new Date(t0.getTime() + 9000))).toBe(false);
    expect(session.endedAt).toEqual(first);
  });

  it('answers session-ended for a session ended by the patient', () => {
    const session = Session.restore({
      ...start().snapshot(),
      status: 'ENDED_BY_PATIENT',
      endedAt: new Date(t0.getTime() + 5000),
    });

    expect(() => session.endByTherapist(t0)).toThrow(SessionEndedError);
    expect(session.endedBy()).toBe('PATIENT');
  });
});
