import type { Profile } from '../domain/profile';

/** The verified caller, as handed over by the presentation layer. */
export interface CallerIdentity {
  uid: string;
  email?: string;
}

/** The `Me` read model. `email` always comes from the verified token. */
export interface Me {
  id: string;
  name: string;
  email: string;
  consent: {
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export function toMe(profile: Profile, tokenEmail: string): Me {
  return {
    id: profile.id,
    name: profile.name.value,
    email: tokenEmail,
    consent: {
      termsVersion: profile.consent.versions.termsVersion,
      privacyVersion: profile.consent.versions.privacyVersion,
      acceptedAt: profile.consent.acceptedAt,
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
