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

/**
 * PLACEHOLDER content only. Every case, name and sentence below is obviously
 * fake and exists so environments are exercisable; none of it is clinical
 * material. The real catalog is a human-required deliverable (see
 * docs/tasks/backend/case-library/HUMAN-REQUIRED.md). Array order is the
 * curated catalog order. Ids are opaque and must never change once shipped.
 */
function placeholder(n: number, note: boolean): Record<Language, CaseContent> {
  return {
    en: {
      title: `Placeholder case ${n}`,
      teaser: `Placeholder teaser ${n}. Not real clinical content.`,
      scenario: `Placeholder scenario ${n}. This text stands in for a short context description.`,
      patientName: `Placeholder Patient ${n}`,
      contentNote: note
        ? `Placeholder content note ${n}: this fake case stands in for sensitive material.`
        : null,
    },
    ru: {
      title: `Заглушка случая ${n}`,
      teaser: `Заглушка описания ${n}. Не настоящий клинический материал.`,
      scenario: `Заглушка сценария ${n}. Этот текст заменяет краткое описание контекста.`,
      patientName: `Заглушка Пациент ${n}`,
      contentNote: note
        ? `Заглушка заметки о содержании ${n}: этот вымышленный случай заменяет чувствительный материал.`
        : null,
    },
  };
}

export const CASE_SEED: readonly SeedCase[] = [
  {
    id: 'placeholder-case-1',
    level: 'EASY',
    category: 'SUBSTANCE_USE',
    avatar: 'LONG_HAIR',
    patientAge: 31,
    content: placeholder(1, false),
  },
  {
    id: 'placeholder-case-2',
    level: 'MEDIUM',
    category: 'SUICIDAL_IDEATION',
    avatar: 'SHORT_HAIR',
    patientAge: 27,
    content: placeholder(2, true),
  },
  {
    id: 'placeholder-case-3',
    level: 'MEDIUM',
    category: 'BOUNDARY_TESTING',
    avatar: 'HAIR_UP',
    patientAge: 45,
    content: placeholder(3, true),
  },
  {
    id: 'placeholder-case-4',
    level: 'HARD',
    category: 'TRAUMA_DISCLOSURE',
    avatar: 'OLDER_GREY',
    patientAge: 63,
    content: placeholder(4, true),
  },
  {
    id: 'placeholder-case-5',
    level: 'HARD',
    category: 'HARM_TO_OTHERS',
    avatar: 'SHORT_HAIR',
    patientAge: 38,
    content: placeholder(5, true),
  },
  {
    id: 'placeholder-case-6',
    level: 'EXTREME',
    category: 'SUICIDAL_IDEATION',
    avatar: 'HAIR_UP',
    patientAge: 52,
    content: placeholder(6, true),
  },
];
