import {
  InvalidRequestError,
  type InvalidParam,
} from '../../../shared/domain-error';
import type { ConsentVersionPolicy } from './consent-version-policy';

/** The Terms/Privacy version pair a user accepted. */
export class ConsentVersions {
  private constructor(
    readonly termsVersion: string,
    readonly privacyVersion: string,
  ) {}

  /** Throws `InvalidRequestError` for unusable or unrecognised versions. */
  static parse(
    input: { terms_version?: unknown; privacy_version?: unknown },
    policy: ConsentVersionPolicy,
  ): ConsentVersions {
    const problems: InvalidParam[] = [];
    const check = (
      name: string,
      value: unknown,
      known: (version: string) => boolean,
    ): string => {
      if (value === undefined || value === null) {
        problems.push({ name, reason: 'REQUIRED' });
      } else if (typeof value !== 'string') {
        problems.push({ name, reason: 'INVALID_TYPE' });
      } else if (!known(value)) {
        problems.push({ name, reason: 'UNKNOWN_VERSION' });
      }
      return typeof value === 'string' ? value : '';
    };
    const terms = check('consent.terms_version', input.terms_version, (v) =>
      policy.isKnownTermsVersion(v),
    );
    const privacy = check(
      'consent.privacy_version',
      input.privacy_version,
      (v) => policy.isKnownPrivacyVersion(v),
    );
    if (problems.length > 0) {
      throw new InvalidRequestError('Invalid consent', problems);
    }
    return new ConsentVersions(terms, privacy);
  }

  static restore(
    termsVersion: string,
    privacyVersion: string,
  ): ConsentVersions {
    return new ConsentVersions(termsVersion, privacyVersion);
  }

  equals(other: ConsentVersions): boolean {
    return (
      this.termsVersion === other.termsVersion &&
      this.privacyVersion === other.privacyVersion
    );
  }
}

/** Recorded acceptance: the versions plus the server-side time of receipt. */
export class Consent {
  constructor(
    readonly versions: ConsentVersions,
    readonly acceptedAt: Date,
  ) {}
}
