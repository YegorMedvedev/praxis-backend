import { ConsentVersions } from './consent';
import { Profile } from './profile';
import { ProfileName } from './profile-name';

const policy = {
  isKnownTermsVersion: (v: string) => v.startsWith('T'),
  isKnownPrivacyVersion: (v: string) => v.startsWith('P'),
};
const versions = (t: string, p: string) =>
  ConsentVersions.parse({ terms_version: t, privacy_version: p }, policy);
const t0 = new Date('2026-01-01T00:00:00Z');
const t1 = new Date('2026-02-01T00:00:00Z');

function profile() {
  return Profile.create({
    id: 'uid-1',
    name: ProfileName.parse('Elena'),
    consent: versions('T1', 'P1'),
    now: t0,
  });
}

describe('ConsentVersions', () => {
  it('reports unknown versions per property', () => {
    expect(() =>
      ConsentVersions.parse(
        { terms_version: 'X', privacy_version: 'P1' },
        policy,
      ),
    ).toThrow(
      expect.objectContaining({
        params: [{ name: 'consent.terms_version', reason: 'UNKNOWN_VERSION' }],
      }),
    );
  });

  it('reports missing and wrongly typed versions', () => {
    expect(() => ConsentVersions.parse({ privacy_version: 5 }, policy)).toThrow(
      expect.objectContaining({
        params: [
          { name: 'consent.terms_version', reason: 'REQUIRED' },
          { name: 'consent.privacy_version', reason: 'INVALID_TYPE' },
        ],
      }),
    );
  });
});

describe('Profile', () => {
  it('starts with consent accepted at creation time', () => {
    const created = profile();
    expect(created.consent.acceptedAt).toEqual(t0);
    expect(created.createdAt).toEqual(t0);
    expect(created.updatedAt).toEqual(t0);
  });

  it('holds no email at all', () => {
    expect(profile()).not.toHaveProperty('email');
  });

  it('returns the same instance when nothing changed', () => {
    const created = profile();
    const same = created.replace({
      name: ProfileName.parse(' Elena '),
      consent: versions('T1', 'P1'),
      now: t1,
    });
    expect(same).toBe(created);
  });

  it('keeps consent when none is supplied and bumps updatedAt on a rename', () => {
    const renamed = profile().replace({
      name: ProfileName.parse('Elena B'),
      now: t1,
    });
    expect(renamed.name.value).toBe('Elena B');
    expect(renamed.updatedAt).toEqual(t1);
    expect(renamed.consent.acceptedAt).toEqual(t0);
    expect(renamed.createdAt).toEqual(t0);
  });

  it('re-records acceptance when the version pair changes', () => {
    const changed = profile().replace({
      name: ProfileName.parse('Elena'),
      consent: versions('T2', 'P1'),
      now: t1,
    });
    expect(changed.consent.versions.termsVersion).toBe('T2');
    expect(changed.consent.acceptedAt).toEqual(t1);
    expect(changed.updatedAt).toEqual(t1);
  });
});
