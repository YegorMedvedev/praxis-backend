import {
  CASE_AVATARS,
  CASE_CATEGORIES,
  CASE_LEVELS,
  Case,
} from '../../domain/case';
import { CASE_SEED } from './case-seed.data';
import { validateAgentIds } from './case-seeder';

describe('case seed data', () => {
  it('has unique ids and every case visible', () => {
    const ids = CASE_SEED.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const seed of CASE_SEED) {
      expect(Case.restore({ ...seed }).isVisible()).toBe(true);
    }
  });

  it('spans every level and avatar, and the categories it uses are valid', () => {
    expect(new Set(CASE_SEED.map((c) => c.level))).toEqual(
      new Set(CASE_LEVELS),
    );
    expect(new Set(CASE_SEED.map((c) => c.avatar))).toEqual(
      new Set(CASE_AVATARS),
    );
    for (const seed of CASE_SEED) {
      expect(CASE_CATEGORIES).toContain(seed.category);
    }
  });

  it('has a case without a content note, and notes on sensitive categories', () => {
    expect(CASE_SEED.some((c) => c.content.en?.contentNote === null)).toBe(
      true,
    );
    // Real cases carry product-owner-written content; only placeholders are checked here.
    const placeholders = CASE_SEED.filter(
      (c) =>
        c.content.en?.title.startsWith('Placeholder case') &&
        c.content.ru?.title.startsWith('Заглушка'),
    );
    for (const seed of placeholders) {
      if (
        ['SUICIDAL_IDEATION', 'HARM_TO_OTHERS', 'TRAUMA_DISCLOSURE'].includes(
          seed.category,
        )
      ) {
        expect(seed.content.en?.contentNote).toBeTruthy();
        expect(seed.content.ru?.contentNote).toBeTruthy();
      }
    }
  });

  it('keeps agent ids valid for every case that has them', () => {
    expect(() => validateAgentIds(CASE_SEED)).not.toThrow();
  });
});

describe('validateAgentIds', () => {
  const base = CASE_SEED[0];
  const withIds = (agentIds: Record<string, string>) => [{ ...base, agentIds }];

  it('accepts valid ids and absent ids', () => {
    expect(() => validateAgentIds(CASE_SEED)).not.toThrow();
    expect(() =>
      validateAgentIds(withIds({ en: 'agent_a', ru: 'x'.repeat(128) })),
    ).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(129)],
    ['inner space', 'a b'],
    ['tab', 'a\tb'],
    ['control character', 'a\u0001b'],
    ['newline', 'a\n'],
  ])('rejects %s naming case and language but not the value', (_n, value) => {
    const run = () => validateAgentIds(withIds({ ru: value }));
    expect(run).toThrow(base.id);
    expect(run).toThrow('"ru"');
    expect(run).not.toThrow(value.trim() === '' ? /^$/ : value);
  });

  it('rejects an id for a language the case has no content in', () => {
    const only = {
      ...base,
      content: { en: base.content.en },
      agentIds: { ru: 'a' },
    };
    expect(() => validateAgentIds([only])).toThrow('"ru"');
  });
});
