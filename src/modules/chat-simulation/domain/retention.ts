/** Transcripts live at most this long after the session's `created_at` (05 FR-6). */
export const RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sessions created at or before this instant are expired. The retention
 * clock starts at session creation, whatever the session's status.
 */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

export function isExpired(createdAt: Date, now: Date): boolean {
  return createdAt.getTime() <= retentionCutoff(now).getTime();
}
