import type { Profile } from './profile';

export interface ProfileRepository {
  findById(id: string): Promise<Profile | null>;
  /**
   * Atomically inserts a new profile. Resolves false, writing nothing, when a
   * profile with the same id already exists (e.g. a concurrent first PUT).
   */
  insertIfAbsent(profile: Profile): Promise<boolean>;
  /** Replaces the profile with the same id (last write wins). */
  save(profile: Profile): Promise<void>;
}
