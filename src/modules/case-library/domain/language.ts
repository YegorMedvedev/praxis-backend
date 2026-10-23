export const LANGUAGES = ['en', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Picks the response language from an `Accept-Language` header. The supported
 * language with the highest q-value wins (ties: header order); regional
 * subtags are ignored (`ru-RU` is `ru`). Absent, malformed or unsupported
 * values fall back to English; the parser never throws.
 */
export function parseAcceptLanguage(header: string | undefined): Language {
  if (!header) return DEFAULT_LANGUAGE;
  const candidates: { language: Language; q: number; index: number }[] = [];
  header.split(',').forEach((part, index) => {
    const [tag, ...params] = part.trim().split(';');
    const language = tag.trim().toLowerCase().split('-')[0];
    if (!isLanguage(language)) return;
    let q = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*(\d(?:\.\d{0,3})?)\s*$/i.exec(param);
      if (match) q = Number(match[1]);
    }
    if (q > 0 && q <= 1) candidates.push({ language, q, index });
  });
  candidates.sort((a, b) => b.q - a.q || a.index - b.index);
  return candidates[0]?.language ?? DEFAULT_LANGUAGE;
}
