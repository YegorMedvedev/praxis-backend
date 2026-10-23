import type { Language } from './language';
import { LANGUAGES } from './language';

export const CASE_LEVELS = ['EASY', 'MEDIUM', 'HARD', 'EXTREME'] as const;
export type CaseLevel = (typeof CASE_LEVELS)[number];

export const CASE_CATEGORIES = [
  'SUICIDAL_IDEATION',
  'HARM_TO_OTHERS',
  'TRAUMA_DISCLOSURE',
  'SUBSTANCE_USE',
  'BOUNDARY_TESTING',
] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const CASE_AVATARS = [
  'LONG_HAIR',
  'SHORT_HAIR',
  'HAIR_UP',
  'OLDER_GREY',
] as const;
export type CaseAvatar = (typeof CASE_AVATARS)[number];

/** Learner-facing text of a case in one language. */
export interface CaseContent {
  title: string;
  teaser: string;
  scenario: string;
  patientName: string;
  /** Complete sentence(s) to display, or null when the case needs no note. */
  contentNote: string | null;
}

/** A case rendered in one language: exactly what the read APIs may expose. */
export interface LocalizedCase extends CaseContent {
  id: string;
  level: CaseLevel;
  category: CaseCategory;
  avatar: CaseAvatar;
  patientAge: number;
}

export interface CaseProps {
  id: string;
  level: CaseLevel;
  category: CaseCategory;
  avatar: CaseAvatar;
  patientAge: number;
  content: Partial<Record<Language, CaseContent>>;
}

/**
 * A curated catalog case. `id` is opaque and stable. Only language-neutral
 * attributes and learner-facing text are modelled; nothing here is a twist,
 * persona or scoring field.
 */
export class Case {
  private constructor(private readonly props: CaseProps) {}

  static restore(props: CaseProps): Case {
    return new Case(props);
  }

  get id(): string {
    return this.props.id;
  }

  /** A case is visible only when it has content in every supported language. */
  isVisible(): boolean {
    return LANGUAGES.every((language) => this.props.content[language]);
  }

  /** The case in `language`, or null when it is hidden. */
  localize(language: Language): LocalizedCase | null {
    const content = this.props.content[language];
    if (!this.isVisible() || !content) return null;
    const { id, level, category, avatar, patientAge } = this.props;
    return { id, level, category, avatar, patientAge, ...content };
  }
}
