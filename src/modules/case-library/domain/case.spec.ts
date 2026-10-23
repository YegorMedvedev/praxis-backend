import { Case, type CaseContent } from './case';

const en: CaseContent = {
  title: 'Placeholder case',
  teaser: 'Placeholder teaser',
  scenario: 'Placeholder scenario',
  patientName: 'Placeholder Patient',
  contentNote: null,
};
const ru: CaseContent = { ...en, title: 'Заглушка', contentNote: 'Заметка' };

const base = {
  id: 'c1',
  level: 'EASY',
  category: 'SUBSTANCE_USE',
  avatar: 'HAIR_UP',
  patientAge: 40,
} as const;

describe('Case', () => {
  it('is visible and localizes when both languages have content', () => {
    const c = Case.restore({ ...base, content: { en, ru } });
    expect(c.isVisible()).toBe(true);
    expect(c.localize('ru')).toEqual({ ...base, ...ru });
    expect(c.localize('en')?.contentNote).toBeNull();
  });

  it.each([{ en }, { ru }, {}])(
    'is hidden when a language is missing',
    (content) => {
      const c = Case.restore({ ...base, content });
      expect(c.isVisible()).toBe(false);
      expect(c.localize('en')).toBeNull();
      expect(c.localize('ru')).toBeNull();
    },
  );
});
