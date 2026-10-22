import { validateEnv } from './app-config';

describe('validateEnv', () => {
  it('applies defaults and returns typed config', () => {
    expect(validateEnv({ DATABASE_URL: 'postgres://db/praxis' })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgres://db/praxis',
    });
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow('DATABASE_URL is required');
  });

  it('rejects an invalid PORT and NODE_ENV', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'x', PORT: 'abc', NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV.*PORT/);
  });

  it('never echoes values in the error', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'x', NODE_ENV: 'secret-value' }),
    ).not.toThrow(/secret-value/);
  });
});
