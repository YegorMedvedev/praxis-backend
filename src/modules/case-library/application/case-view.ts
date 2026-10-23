import type { LocalizedCase } from '../domain/case';
import type { CompletionState } from './completion-index';

/** A localized case with the caller's completion state: what the read APIs return. */
export type CaseView = LocalizedCase & CompletionState;
