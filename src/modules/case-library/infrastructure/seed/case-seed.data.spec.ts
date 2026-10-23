import {
  CASE_AVATARS,
  CASE_CATEGORIES,
  CASE_LEVELS,
  Case,
} from '../../domain/case';
import { CASE_SEED } from './case-seed.data';

describe('case seed data', () => {
  it('has unique ids and every case visible', () => {
    const ids = CASE_SEED.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const seed of CASE_SEED) {
      expect(Case.restore({ ...seed }).isVisible()).toBe(true);
    }
  });

  it('spans every level, category and avatar', () => {
    expect(new Set(CASE_SEED.map((c) => c.level))).toEqual(
      new Set(CASE_LEVELS),
    );
    expect(new Set(CASE_SEED.map((c) => c.category))).toEqual(
      new Set(CASE_CATEGORIES),
    );
    expect(new Set(CASE_SEED.map((c) => c.avatar))).toEqual(
      new Set(CASE_AVATARS),
    );
  });

  it('has a case without a content note, and notes on sensitive categories', () => {
    expect(CASE_SEED.some((c) => c.content.en?.contentNote === null)).toBe(
      true,
    );
    for (const seed of CASE_SEED) {
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

  it('is obviously placeholder content', () => {
    for (const seed of CASE_SEED) {
      expect(seed.content.en?.title).toMatch(/^Placeholder case \d+$/);
      expect(seed.content.ru?.title).toMatch(/^Заглушка случая \d+$/);
    }
  });
});
