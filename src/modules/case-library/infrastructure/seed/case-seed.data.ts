import type {
  CaseAvatar,
  CaseCategory,
  CaseContent,
  CaseLevel,
} from '../../domain/case';
import type { Language } from '../../domain/language';

export interface SeedCase {
  id: string;
  level: CaseLevel;
  category: CaseCategory;
  avatar: CaseAvatar;
  patientAge: number;
  /** A case missing a language is stored but hidden by the visibility rule. */
  content: Partial<Record<Language, CaseContent>>;
  /**
   * Server-only patient agent id per language, kept apart from `content`.
   * Omitting a language leaves any stored id untouched. Real ids are a human
   * deliverable (HUMAN-REQUIRED.md); the placeholder seed has none.
   */
  agentIds?: Partial<Record<Language, string>>;
}

export const CASE_SEED: readonly SeedCase[] = [
  {
    id: 'placeholder-case-1',
    level: 'EASY',
    category: 'TRAUMA_DISCLOSURE',
    avatar: 'LONG_HAIR',
    patientAge: 33,
    content: {
      en: {
        title: 'Placeholder case 1',
        teaser: 'Placeholder teaser 1. Not real clinical content.',
        scenario:
          'Placeholder scenario 1. This text stands in for a short context description.',
        patientName: 'Placeholder Patient 1',
        contentNote: null,
      },
      ru: {
        title: 'Если кого-то забыли — это я',
        teaser: ' Она успешна, живёт одна за границей и постоянно перемещается между странами, но в отношениях снова и снова оказывается «лишней». На первой в жизни терапии она пытается понять, почему её не выбирают, и почему она так спокойно рассказывает о том, что другим кажется невыносимым.',
        scenario:
          'Впервые пришла к психотерапевту из-за сложностей в отношениях. За её самостоятельностью, иронией и привычкой «со всем справляться» скрывается ранний опыт оставленности и постоянное чувство, что её не замечают и не выбирают.',
        patientName: 'Эльмира',
        contentNote: null,
      },
    },
    agentIds: {
      en: 'agent_698c8ffe64614ddbb34f7cbd94e9fbb2108d41447baf40df95',
      ru: 'agent_698c8ffe64614ddbb34f7cbd94e9fbb2108d41447baf40df95',
    },
  },
];
