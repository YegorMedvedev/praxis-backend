import { InvalidRequestError } from '../../../shared/domain-error';
import { FakeConsentVersionPolicy, InMemoryProfileRepository } from './fakes';
import { GetMe } from './get-me';
import { PutMe } from './put-me';

const caller = { uid: 'uid-1', email: 'elena@example.test' };
const consent = { terms_version: 'T1', privacy_version: 'P1' };

function setup() {
  let now = new Date('2026-01-01T10:00:00Z');
  const repo = new InMemoryProfileRepository();
  const clock = { now: () => now };
  return {
    repo,
    putMe: new PutMe(repo, new FakeConsentVersionPolicy(), clock),
    getMe: new GetMe(repo),
    advance: (to: string) => {
      now = new Date(to);
    },
  };
}

async function paramsOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidRequestError);
    return (error as InvalidRequestError).params;
  }
  throw new Error('expected a failure');
}

describe('PutMe', () => {
  it('creates a profile with a trimmed name, the token identity and server time', async () => {
    const { putMe } = setup();

    const { me, created } = await putMe.execute({
      caller,
      name: '  Elena  ',
      consent,
    });

    expect(created).toBe(true);
    expect(me).toEqual({
      id: 'uid-1',
      name: 'Elena',
      email: 'elena@example.test',
      consent: {
        termsVersion: 'T1',
        privacyVersion: 'P1',
        acceptedAt: new Date('2026-01-01T10:00:00Z'),
      },
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:00:00Z'),
    });
  });

  it('requires consent on create', async () => {
    const { putMe } = setup();
    expect(await paramsOf(putMe.execute({ caller, name: 'Elena' }))).toEqual([
      { name: 'consent', reason: 'REQUIRED' },
    ]);
  });

  it('rejects unknown versions', async () => {
    const { putMe } = setup();
    expect(
      await paramsOf(
        putMe.execute({
          caller,
          name: 'Elena',
          consent: { terms_version: 'T9', privacy_version: 'P9' },
        }),
      ),
    ).toEqual([
      { name: 'consent.terms_version', reason: 'UNKNOWN_VERSION' },
      { name: 'consent.privacy_version', reason: 'UNKNOWN_VERSION' },
    ]);
  });

  it('reports name and consent problems together', async () => {
    const { putMe } = setup();
    expect(await paramsOf(putMe.execute({ caller, name: 'A' }))).toEqual([
      { name: 'name', reason: 'TOO_SHORT' },
      { name: 'consent', reason: 'REQUIRED' },
    ]);
  });

  it('saves nothing when the request is invalid', async () => {
    const { putMe, repo } = setup();
    await paramsOf(putMe.execute({ caller, name: '', consent }));
    expect(repo.saves).toBe(0);
  });

  it('replaces an existing profile without consent, keeping acceptance', async () => {
    const { putMe, advance } = setup();
    await putMe.execute({ caller, name: 'Elena', consent });
    advance('2026-01-02T10:00:00Z');

    const { me, created } = await putMe.execute({ caller, name: 'Elena B' });

    expect(created).toBe(false);
    expect(me.name).toBe('Elena B');
    expect(me.consent.acceptedAt).toEqual(new Date('2026-01-01T10:00:00Z'));
    expect(me.updatedAt).toEqual(new Date('2026-01-02T10:00:00Z'));
  });

  it('is idempotent: an identical repeat changes and writes nothing', async () => {
    const { putMe, repo, advance } = setup();
    const first = await putMe.execute({ caller, name: 'Elena', consent });
    advance('2026-01-02T10:00:00Z');

    const second = await putMe.execute({ caller, name: 'Elena', consent });

    expect(second.created).toBe(false);
    expect(second.me).toEqual(first.me);
    expect(repo.saves).toBe(1);
  });

  it('re-records acceptance when the version pair changes', async () => {
    const { putMe, advance } = setup();
    await putMe.execute({ caller, name: 'Elena', consent });
    advance('2026-01-02T10:00:00Z');

    const { me } = await putMe.execute({
      caller,
      name: 'Elena',
      consent: { terms_version: 'T2', privacy_version: 'P1' },
    });

    expect(me.consent.termsVersion).toBe('T2');
    expect(me.consent.acceptedAt).toEqual(new Date('2026-01-02T10:00:00Z'));
  });

  it('uses the existing profile when a concurrent first PUT wins the insert', async () => {
    const { putMe, repo } = setup();
    const winner = await putMe.execute({ caller, name: 'Elena', consent });
    // The loser read "absent" before the winner inserted.
    const realFind = repo.findById.bind(repo);
    let first = true;
    repo.findById = (id) => {
      if (first) {
        first = false;
        return Promise.resolve(null);
      }
      return realFind(id);
    };

    const loser = await putMe.execute({ caller, name: 'Elena', consent });

    expect(winner.created).toBe(true);
    expect(loser.created).toBe(false);
    expect(loser.me).toEqual(winner.me);
  });

  it('refuses a token without an email', async () => {
    const { putMe } = setup();
    await expect(
      putMe.execute({ caller: { uid: 'u' }, name: 'Elena', consent }),
    ).rejects.toMatchObject({ code: 'incomplete-identity' });
  });
});

describe('GetMe', () => {
  it('answers profile-not-found when there is no profile', async () => {
    const { getMe } = setup();
    await expect(getMe.execute(caller)).rejects.toMatchObject({
      code: 'profile-not-found',
    });
  });

  it('returns the profile with the email from the token, not storage', async () => {
    const { putMe, getMe } = setup();
    await putMe.execute({ caller, name: 'Elena', consent });

    const me = await getMe.execute({ uid: 'uid-1', email: 'new@example.test' });

    expect(me.email).toBe('new@example.test');
    expect(me.name).toBe('Elena');
  });
});
