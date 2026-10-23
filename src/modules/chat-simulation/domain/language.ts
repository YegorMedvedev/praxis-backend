/** Session languages. Fixed for the lifetime of a session. */
export const LANGUAGES = ['en', 'ru'] as const;

export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}
