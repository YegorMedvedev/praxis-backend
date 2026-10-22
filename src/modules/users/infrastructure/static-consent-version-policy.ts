import type { ConsentVersionPolicy } from '../domain/consent-version-policy';

/** Recognised versions fixed at boot from configuration. */
export class StaticConsentVersionPolicy implements ConsentVersionPolicy {
  private readonly terms: ReadonlySet<string>;
  private readonly privacy: ReadonlySet<string>;

  constructor(terms: readonly string[], privacy: readonly string[]) {
    this.terms = new Set(terms);
    this.privacy = new Set(privacy);
  }

  isKnownTermsVersion(version: string): boolean {
    return this.terms.has(version);
  }

  isKnownPrivacyVersion(version: string): boolean {
    return this.privacy.has(version);
  }
}
