/**
 * Port: runs work after the caller has been answered. The runner must never
 * let a failure escape (no unhandled rejection) and may drop work when full.
 */
export interface BackgroundRunner {
  run(task: () => Promise<void>): void;
}
