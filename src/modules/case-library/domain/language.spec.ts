import { parseAcceptLanguage } from './language';

describe('parseAcceptLanguage', () => {
  it.each([
    [undefined, 'en'],
    ['', 'en'],
    ['en', 'en'],
    ['ru', 'ru'],
    ['RU', 'ru'],
    ['ru-RU', 'ru'],
    ['en-US,en;q=0.9', 'en'],
    ['de', 'en'],
    ['*', 'en'],
    ['fr, de;q=0.8', 'en'],
    ['de, ru;q=0.5', 'ru'],
    ['en;q=0.5, ru;q=0.9', 'ru'],
    ['ru;q=0.5, en;q=0.9', 'en'],
    ['ru;q=0, en;q=0.1', 'en'],
    ['ru;q=0', 'en'],
    ['ru, en', 'ru'],
    ['en, ru', 'en'],
    ['ru;q=abc', 'ru'],
    [';;;,,,', 'en'],
    ['ru;q=5', 'en'],
  ])('maps %p to %p', (header, expected) => {
    expect(parseAcceptLanguage(header)).toBe(expected);
  });
});
