import type { Clock } from '../../../shared/clock';
import {
  IncompleteIdentityError,
  InvalidRequestError,
  type InvalidParam,
} from '../../../shared/domain-error';
import { ConsentVersions } from '../domain/consent';
import type { ConsentVersionPolicy } from '../domain/consent-version-policy';
import { Profile } from '../domain/profile';
import { ProfileName } from '../domain/profile-name';
import type { ProfileRepository } from '../domain/profile.repository';
import { toMe, type CallerIdentity, type Me } from './me';

export interface PutMeCommand {
  caller: CallerIdentity;
  /** Raw request values; validated here. */
  name: unknown;
  consent?: { terms_version?: unknown; privacy_version?: unknown } | null;
}

export interface PutMeResult {
  me: Me;
  created: boolean;
}

/** Creates the caller's profile, or replaces it. Idempotent. */
export class PutMe {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly consentPolicy: ConsentVersionPolicy,
    private readonly clock: Clock,
  ) {}

  async execute(command: PutMeCommand): Promise<PutMeResult> {
    const { caller } = command;
    // ASSUMPTION (not in the spec registry): a token without an email cannot
    // satisfy `Me.email` (FR-6), so it is refused with the legacy
    // `incomplete-identity` 403.
    if (!caller.email) {
      throw new IncompleteIdentityError('Token carries no email');
    }
    const existing = await this.profiles.findById(caller.uid);

    const problems: InvalidParam[] = [];
    const collect = <T>(parse: () => T): T | undefined => {
      try {
        return parse();
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          problems.push(...error.params);
          return undefined;
        }
        throw error;
      }
    };

    const name = collect(() => ProfileName.parse(command.name));
    let consent: ConsentVersions | undefined;
    if (command.consent !== undefined && command.consent !== null) {
      consent = collect(() =>
        ConsentVersions.parse(command.consent ?? {}, this.consentPolicy),
      );
    } else if (!existing) {
      problems.push({ name: 'consent', reason: 'REQUIRED' });
    }
    if (problems.length > 0 || !name) {
      throw new InvalidRequestError('Invalid request', problems);
    }

    const now = this.clock.now();
    let current = existing;
    if (!current) {
      if (!consent) {
        throw new InvalidRequestError('Invalid request', [
          { name: 'consent', reason: 'REQUIRED' },
        ]);
      }
      const profile = Profile.create({
        id: caller.uid,
        name,
        consent,
        now,
      });
      if (await this.profiles.insertIfAbsent(profile)) {
        return { me: toMe(profile, caller.email), created: true };
      }
      // Lost a race with a concurrent first PUT: fall through to replace the
      // winner's profile, which is never overwritten wholesale.
      current = await this.profiles.findById(caller.uid);
      if (!current) {
        throw new Error('Profile vanished after a conflicting insert');
      }
    }

    const replaced = current.replace({ name, consent, now });
    if (replaced !== current) {
      await this.profiles.save(replaced);
    }
    return { me: toMe(replaced, caller.email), created: false };
  }
}
