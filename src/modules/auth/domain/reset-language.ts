export const RESET_LANGUAGES = ['en', 'ru'] as const;

export type ResetLanguage = (typeof RESET_LANGUAGES)[number];

export const DEFAULT_RESET_LANGUAGE: ResetLanguage = 'en';
