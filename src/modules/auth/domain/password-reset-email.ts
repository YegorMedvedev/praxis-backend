import type { ResetLanguage } from './reset-language';

export interface PasswordResetEmailContent {
  subject: string;
  text: string;
  html: string;
}

/** Fixed by Firebase; the app copy constant is 60 minutes too. */
const LIFETIME_MINUTES = 60;

interface Copy {
  htmlLang: string;
  subject: string;
  heading: string;
  intro: string;
  action: string;
  lifetime: string;
  ignore: string;
  placeholderNote: string;
}

// PLACEHOLDER copy: final EN/RU wording and branding are owned by the product
// owner (see HUMAN-REQUIRED.md). Do not treat these strings as approved.
const COPY: Record<ResetLanguage, Copy> = {
  en: {
    htmlLang: 'en',
    subject: 'Praxis: reset your password',
    heading: 'Reset your Praxis password',
    intro: 'We received a request to reset the password for your account.',
    action: 'Choose a new password',
    lifetime: `This link works for ${LIFETIME_MINUTES} minutes.`,
    ignore: 'If you did not ask for this, you can ignore this email.',
    placeholderNote: '[PLACEHOLDER COPY: replace with approved text]',
  },
  ru: {
    htmlLang: 'ru',
    subject: 'Praxis: сброс пароля',
    heading: 'Сброс пароля в Praxis',
    intro: 'Мы получили запрос на сброс пароля для вашей учётной записи.',
    action: 'Задать новый пароль',
    lifetime: `Ссылка действует ${LIFETIME_MINUTES} минут.`,
    ignore: 'Если вы не отправляли этот запрос, просто проигнорируйте письмо.',
    placeholderNote: '[PLACEHOLDER COPY: замените утверждённым текстом]',
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the reset email. Pure: one link, no password, no personal data other
 * than what the recipient already knows (the address is the envelope only).
 */
export function buildPasswordResetEmail(input: {
  language: ResetLanguage;
  link: string;
}): PasswordResetEmailContent {
  const copy = COPY[input.language];
  const href = escapeHtml(input.link);

  const text = [
    copy.heading,
    '',
    copy.intro,
    '',
    `${copy.action}: ${input.link}`,
    '',
    copy.lifetime,
    copy.ignore,
    '',
    copy.placeholderNote,
  ].join('\n');

  const html = [
    '<!doctype html>',
    `<html lang="${copy.htmlLang}">`,
    '<head><meta charset="utf-8"><title>',
    escapeHtml(copy.subject),
    '</title></head>',
    '<body>',
    `<h1>${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p><a href="${href}">${escapeHtml(copy.action)}</a></p>`,
    `<p>${escapeHtml(copy.lifetime)}</p>`,
    `<p>${escapeHtml(copy.ignore)}</p>`,
    `<p><small>${escapeHtml(copy.placeholderNote)}</small></p>`,
    '</body></html>',
  ].join('');

  return { subject: copy.subject, text, html };
}
