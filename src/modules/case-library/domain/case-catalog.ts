import type { Case } from './case';

/**
 * Read-only view of the curated catalog. Every method returns VISIBLE cases
 * only (complete content in every supported language); hidden cases do not
 * exist as far as callers are concerned.
 */
export interface CaseCatalog {
  /** Visible cases in the curated, stable order. */
  listVisible(): Promise<Case[]>;
  /** Ids of the visible cases, same order as `listVisible`. */
  listVisibleIds(): Promise<string[]>;
  /** Null for an unknown, malformed or hidden id; never throws on odd input. */
  findVisibleById(id: string): Promise<Case | null>;
}
