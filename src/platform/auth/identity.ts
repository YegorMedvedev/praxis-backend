/** The caller, as proven by a verified ID token. Never taken from client input. */
export interface AuthenticatedIdentity {
  /** Firebase uid (the token `sub` claim). */
  uid: string;
  /** From the verified token; may be absent (e.g. a phone-only account). */
  email?: string;
}
