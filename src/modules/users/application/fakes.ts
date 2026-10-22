import type { ConsentVersionPolicy } from '../domain/consent-version-policy';
import type { Profile } from '../domain/profile';
import type { ProfileRepository } from '../domain/profile.repository';

/** In-memory fakes for use case tests. */
export class InMemoryProfileRepository implements ProfileRepository {
  readonly profiles = new Map<string, Profile>();
  saves = 0;

  findById(id: string): Promise<Profile | null> {
    return Promise.resolve(this.profiles.get(id) ?? null);
  }

  insertIfAbsent(profile: Profile): Promise<boolean> {
    if (this.profiles.has(profile.id)) return Promise.resolve(false);
    this.saves += 1;
    this.profiles.set(profile.id, profile);
    return Promise.resolve(true);
  }

  save(profile: Profile): Promise<void> {
    this.saves += 1;
    this.profiles.set(profile.id, profile);
    return Promise.resolve();
  }
}

export class FakeConsentVersionPolicy implements ConsentVersionPolicy {
  constructor(
    private readonly terms: string[] = ['T1', 'T2'],
    private readonly privacy: string[] = ['P1', 'P2'],
  ) {}

  isKnownTermsVersion(version: string): boolean {
    return this.terms.includes(version);
  }

  isKnownPrivacyVersion(version: string): boolean {
    return this.privacy.includes(version);
  }
}
