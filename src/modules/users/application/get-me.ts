import {
  IncompleteIdentityError,
  ProfileNotFoundError,
} from '../../../shared/domain-error';
import type { ProfileRepository } from '../domain/profile.repository';
import { toMe, type CallerIdentity, type Me } from './me';

export class GetMe {
  constructor(private readonly profiles: ProfileRepository) {}

  async execute(caller: CallerIdentity): Promise<Me> {
    if (!caller.email) {
      throw new IncompleteIdentityError('Token carries no email');
    }
    const profile = await this.profiles.findById(caller.uid);
    if (!profile) {
      throw new ProfileNotFoundError('No profile for the caller');
    }
    return toMe(profile, caller.email);
  }
}
