/**
 * Runs `work` in one atomic unit: every repository and port used inside it
 * (sessions, the cleanup queue, and the case completion owned by another
 * module) commits together or not at all.
 */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
