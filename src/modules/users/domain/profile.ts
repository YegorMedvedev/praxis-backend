import { Consent, type ConsentVersions } from './consent';
import type { ProfileName } from './profile-name';

export interface ProfileState {
  id: string;
  name: ProfileName;
  consent: Consent;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The caller's profile. `id` is the Firebase uid. The email is deliberately
 * not part of it: it is read from the verified token only (FR-6) and never
 * persisted.
 */
export class Profile {
  private constructor(private readonly state: ProfileState) {}

  static create(input: {
    id: string;
    name: ProfileName;
    consent: ConsentVersions;
    now: Date;
  }): Profile {
    return new Profile({
      id: input.id,
      name: input.name,
      consent: new Consent(input.consent, input.now),
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static restore(state: ProfileState): Profile {
    return new Profile(state);
  }

  get id(): string {
    return this.state.id;
  }
  get name(): ProfileName {
    return this.state.name;
  }
  get consent(): Consent {
    return this.state.consent;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  /**
   * Replaces the editable state. Returns this very instance when nothing
   * changed, so an identical repeated request leaves `updatedAt` and
   * `consent.acceptedAt` untouched. A changed version pair re-records
   * acceptance at `now`.
   */
  replace(input: {
    name: ProfileName;
    consent?: ConsentVersions;
    now: Date;
  }): Profile {
    const consent =
      input.consent && !input.consent.equals(this.state.consent.versions)
        ? new Consent(input.consent, input.now)
        : this.state.consent;
    if (input.name.equals(this.state.name) && consent === this.state.consent) {
      return this;
    }
    return new Profile({
      ...this.state,
      name: input.name,
      consent,
      updatedAt: input.now,
    });
  }
}
