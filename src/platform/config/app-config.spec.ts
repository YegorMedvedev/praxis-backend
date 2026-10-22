import { validateEnv } from './app-config';

const base = {
  DATABASE_URL: 'postgres://db/praxis',
  FIREBASE_PROJECT_ID: 'fake-project',
  CONSENT_TERMS_VERSIONS: 'T1',
  CONSENT_PRIVACY_VERSIONS: 'P1',
};

describe('validateEnv', () => {
  it('applies defaults and returns typed config', () => {
    expect(validateEnv(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY_HOPS: 0,
      DATABASE_URL: 'postgres://db/praxis',
      FIREBASE_PROJECT_ID: 'fake-project',
      FIREBASE_CREDENTIALS_JSON: undefined,
      FIREBASE_AUTH_EMULATOR_HOST: undefined,
      CONSENT_TERMS_VERSIONS: ['T1'],
      CONSENT_PRIVACY_VERSIONS: ['P1'],
    });
  });

  describe('consent versions', () => {
    it('parses comma-separated lists, trimming and de-duplicating', () => {
      const config = validateEnv({
        ...base,
        CONSENT_TERMS_VERSIONS: ' T1, T2 ,T1',
        CONSENT_PRIVACY_VERSIONS: 'P1,P2',
      });
      expect(config.CONSENT_TERMS_VERSIONS).toEqual(['T1', 'T2']);
      expect(config.CONSENT_PRIVACY_VERSIONS).toEqual(['P1', 'P2']);
    });

    it.each([undefined, '', '  ', 'T1,', ',', 'T1,,T2'])(
      'requires CONSENT_TERMS_VERSIONS and CONSENT_PRIVACY_VERSIONS (%p)',
      (value) => {
        expect(() =>
          validateEnv({ ...base, CONSENT_TERMS_VERSIONS: value }),
        ).toThrow('CONSENT_TERMS_VERSIONS is required');
        expect(() =>
          validateEnv({ ...base, CONSENT_PRIVACY_VERSIONS: value }),
        ).toThrow('CONSENT_PRIVACY_VERSIONS is required');
      },
    );
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => validateEnv({ FIREBASE_PROJECT_ID: 'p' })).toThrow(
      'DATABASE_URL is required',
    );
  });

  it('rejects an invalid PORT and NODE_ENV', () => {
    expect(() =>
      validateEnv({ ...base, PORT: 'abc', NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV.*PORT/);
  });

  it('never echoes values in the error', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'secret-value' }),
    ).not.toThrow(/secret-value/);
  });

  describe('Firebase', () => {
    it.each([undefined, '', '   '])(
      'requires FIREBASE_PROJECT_ID (%p)',
      (value) => {
        expect(() =>
          validateEnv({
            ...base,
            DATABASE_URL: 'x',
            FIREBASE_PROJECT_ID: value,
          }),
        ).toThrow('FIREBASE_PROJECT_ID is required');
      },
    );

    it('accepts credentials that parse as a JSON object', () => {
      const json = '{"type":"service_account"}';
      expect(
        validateEnv({ ...base, FIREBASE_CREDENTIALS_JSON: json })
          .FIREBASE_CREDENTIALS_JSON,
      ).toBe(json);
    });

    it.each(['not-json-SECRET', '[1,2]', '"str"', 'null', '42'])(
      'rejects credentials that are not a JSON object without echoing them (%s)',
      (value) => {
        let message = '';
        try {
          validateEnv({ ...base, FIREBASE_CREDENTIALS_JSON: value });
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toContain('FIREBASE_CREDENTIALS_JSON');
        expect(message).not.toContain(value);
      },
    );

    it('treats empty credentials as absent', () => {
      expect(
        validateEnv({ ...base, FIREBASE_CREDENTIALS_JSON: '' })
          .FIREBASE_CREDENTIALS_JSON,
      ).toBeUndefined();
    });

    it('accepts an emulator host outside production', () => {
      expect(
        validateEnv({ ...base, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })
          .FIREBASE_AUTH_EMULATOR_HOST,
      ).toBe('127.0.0.1:9099');
    });

    it.each(['localhost', '127.0.0.1:abc', 'http://h:9099', ':9099'])(
      'rejects a malformed emulator host (%s)',
      (value) => {
        expect(() =>
          validateEnv({ ...base, FIREBASE_AUTH_EMULATOR_HOST: value }),
        ).toThrow('FIREBASE_AUTH_EMULATOR_HOST must be host:port');
      },
    );

    it('refuses to boot with the emulator in production', () => {
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        }),
      ).toThrow(/FIREBASE_AUTH_EMULATOR_HOST.*production/);
    });
  });

  describe('TRUST_PROXY_HOPS', () => {
    it('defaults to 0 (no proxy trusted)', () => {
      expect(validateEnv(base).TRUST_PROXY_HOPS).toBe(0);
    });

    it('accepts a non-negative integer', () => {
      expect(
        validateEnv({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS,
      ).toBe(1);
    });

    it.each(['-1', '1.5', 'true', 'abc', ''])('rejects %p', (value) => {
      expect(() => validateEnv({ ...base, TRUST_PROXY_HOPS: value })).toThrow(
        'TRUST_PROXY_HOPS must be a non-negative integer',
      );
    });
  });
});
