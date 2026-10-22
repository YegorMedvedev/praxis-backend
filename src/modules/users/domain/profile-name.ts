import {
  InvalidRequestError,
  type InvalidParam,
} from '../../../shared/domain-error';

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 100;

/** The display name: trimmed, 2 to 100 characters after trimming. */
export class ProfileName {
  private constructor(readonly value: string) {}

  /** Throws `InvalidRequestError` naming `name` when the input is unusable. */
  static parse(input: unknown): ProfileName {
    const reason = ProfileName.check(input);
    if (reason.error) {
      throw new InvalidRequestError('Invalid name', [reason.error]);
    }
    return new ProfileName(reason.value);
  }

  /** Rehydrates a stored, already valid name. */
  static restore(value: string): ProfileName {
    return new ProfileName(value);
  }

  private static check(
    input: unknown,
  ):
    | { value: string; error?: undefined }
    | { value?: undefined; error: InvalidParam } {
    if (input === undefined || input === null) {
      return { error: { name: 'name', reason: 'REQUIRED' } };
    }
    if (typeof input !== 'string') {
      return { error: { name: 'name', reason: 'INVALID_TYPE' } };
    }
    const trimmed = input.trim();
    // Count characters (code points), not UTF-16 units.
    const length = [...trimmed].length;
    // Blank by choice reads as REQUIRED, not TOO_SHORT.
    if (length === 0) {
      return { error: { name: 'name', reason: 'REQUIRED' } };
    }
    // Control characters (NUL included, which PostgreSQL cannot store).
    if (/\p{Cc}/u.test(trimmed)) {
      return { error: { name: 'name', reason: 'INVALID_VALUE' } };
    }
    if (length < NAME_MIN_LENGTH) {
      return { error: { name: 'name', reason: 'TOO_SHORT' } };
    }
    if (length > NAME_MAX_LENGTH) {
      return { error: { name: 'name', reason: 'TOO_LONG' } };
    }
    return { value: trimmed };
  }

  equals(other: ProfileName): boolean {
    return this.value === other.value;
  }
}
