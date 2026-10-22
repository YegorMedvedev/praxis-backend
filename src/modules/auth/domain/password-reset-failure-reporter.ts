export type PasswordResetStage =
  'link-generation' | 'link-parsing' | 'mailing' | 'throttled' | 'dropped';

/**
 * Port: records that a reset attempt failed silently. Only the stage and the
 * error CLASS name are passed; never the address, link, code or message.
 */
export interface PasswordResetFailureReporter {
  report(stage: PasswordResetStage, errorName: string): void;
}
