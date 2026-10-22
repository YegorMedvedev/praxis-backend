/**
 * Port: silent per-address limit. `false` means "too many recent requests for
 * this address"; the caller then does nothing and still answers 202.
 */
export interface PasswordResetThrottle {
  allow(email: string): boolean;
}
