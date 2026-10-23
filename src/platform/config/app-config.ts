export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  NODE_ENV: NodeEnv;
  PORT: number;
  /** Number of trusted reverse-proxy hops in front of the app; 0 trusts none. */
  TRUST_PROXY_HOPS: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  /** Secret; never logged or given a default. */
  DB_PASSWORD: string;
  DB_NAME: string;
  FIREBASE_PROJECT_ID: string;
  /** Raw service-account JSON (a secret); absent means Application Default Credentials. */
  FIREBASE_CREDENTIALS_JSON?: string;
  /** host:port of the Firebase Auth emulator; never allowed in production. */
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** Recognised Terms of Service version identifiers (comma-separated in env). */
  CONSENT_TERMS_VERSIONS: string[];
  /** Recognised Privacy Policy version identifiers (comma-separated in env). */
  CONSENT_PRIVACY_VERSIONS: string[];
  /** Trusted app origin the emailed reset link points at (no trailing slash). */
  APP_BASE_URL: string;
  /** Resend API credential (a secret). */
  RESEND_API_KEY: string;
  /** Resend-verified sender address for reset emails. */
  PASSWORD_RESET_EMAIL_FROM: string;
  /** Requests per client IP per window on POST /auth/password-reset. */
  PASSWORD_RESET_RATE_LIMIT: number;
  PASSWORD_RESET_RATE_WINDOW_MS: number;
  /** Browser origins allowed by CORS; empty disables CORS, ['*'] allows any (never in production). */
  CORS_ALLOWED_ORIGINS: string[];
  /** How long browsers may cache a preflight answer. */
  CORS_MAX_AGE_SECONDS: number;
}

const NODE_ENVS: readonly string[] = ['development', 'test', 'production'];

const HOST_PORT = /^[A-Za-z0-9.-]+:\d{1,5}$/;

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Plain dot-atom address: no quotes, commas, angle brackets, whitespace or control characters. */
const EMAIL_ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Returns the origin of an absolute http(s) URL with no path/query, else undefined. */
function parseOrigin(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    const bare =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '';
    return bare ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Optional positive integer with a default; undefined when unusable. */
function parsePositiveInt(
  value: unknown,
  fallback: number,
): number | undefined {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

/** Parses a required comma-separated list; returns undefined when unusable. */
function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value.split(',').map((item) => item.trim());
  if (items.length === 0 || items.some((item) => item.length === 0)) {
    return undefined;
  }
  return [...new Set(items)];
}

/**
 * Validates raw environment variables. Error messages name the variable only,
 * never its value, so secrets cannot leak into logs.
 */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const problems: string[] = [];

  const nodeEnv = String(raw.NODE_ENV ?? 'development');
  if (!NODE_ENVS.includes(nodeEnv)) {
    problems.push(`NODE_ENV must be one of: ${NODE_ENVS.join(', ')}`);
  }

  const port = Number(raw.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT must be an integer between 1 and 65535');
  }

  const rawHops = raw.TRUST_PROXY_HOPS;
  const hops = rawHops === undefined || rawHops === null ? 0 : Number(rawHops);
  if (
    typeof rawHops === 'boolean' ||
    (typeof rawHops === 'string' && rawHops.trim() === '') ||
    !Number.isInteger(hops) ||
    hops < 0
  ) {
    problems.push('TRUST_PROXY_HOPS must be a non-negative integer');
  }

  const dbSettings = {} as Record<
    'DB_HOST' | 'DB_USER' | 'DB_PASSWORD' | 'DB_NAME',
    string
  >;
  for (const name of [
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
  ] as const) {
    const value = raw[name];
    if (typeof value !== 'string' || value.length === 0) {
      problems.push(`${name} is required`);
    } else {
      dbSettings[name] = value;
    }
  }

  const dbPort = Number(raw.DB_PORT ?? 5432);
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    problems.push('DB_PORT must be an integer between 1 and 65535');
  }

  const projectId = raw.FIREBASE_PROJECT_ID;
  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    problems.push('FIREBASE_PROJECT_ID is required');
  }

  let credentials: string | undefined;
  const rawCredentials = raw.FIREBASE_CREDENTIALS_JSON;
  if (typeof rawCredentials === 'string' && rawCredentials.length > 0) {
    credentials = rawCredentials;
    if (!isJsonObject(rawCredentials)) {
      problems.push('FIREBASE_CREDENTIALS_JSON must be a JSON object');
    }
  } else if (
    rawCredentials !== undefined &&
    typeof rawCredentials !== 'string'
  ) {
    problems.push('FIREBASE_CREDENTIALS_JSON must be a JSON object');
  }

  let emulatorHost: string | undefined;
  const rawEmulator = raw.FIREBASE_AUTH_EMULATOR_HOST;
  if (typeof rawEmulator === 'string' && rawEmulator.length > 0) {
    emulatorHost = rawEmulator;
    if (!HOST_PORT.test(rawEmulator)) {
      problems.push('FIREBASE_AUTH_EMULATOR_HOST must be host:port');
    } else if (nodeEnv === 'production') {
      problems.push(
        'FIREBASE_AUTH_EMULATOR_HOST must not be set when NODE_ENV is production',
      );
    }
  }

  const termsVersions = parseList(raw.CONSENT_TERMS_VERSIONS);
  if (!termsVersions) {
    problems.push(
      'CONSENT_TERMS_VERSIONS is required (comma-separated, no empty items)',
    );
  }
  const privacyVersions = parseList(raw.CONSENT_PRIVACY_VERSIONS);
  if (!privacyVersions) {
    problems.push(
      'CONSENT_PRIVACY_VERSIONS is required (comma-separated, no empty items)',
    );
  }

  const appBase = parseOrigin(raw.APP_BASE_URL);
  if (!appBase) {
    problems.push(
      'APP_BASE_URL is required and must be an absolute http(s) origin without path',
    );
  } else if (nodeEnv === 'production' && appBase.protocol !== 'https:') {
    problems.push('APP_BASE_URL must use https when NODE_ENV is production');
  }

  const resendKey = raw.RESEND_API_KEY;
  if (typeof resendKey !== 'string' || resendKey.trim().length === 0) {
    problems.push('RESEND_API_KEY is required');
  }

  const resetFrom = raw.PASSWORD_RESET_EMAIL_FROM;
  if (typeof resetFrom !== 'string' || !EMAIL_ADDRESS.test(resetFrom.trim())) {
    problems.push(
      'PASSWORD_RESET_EMAIL_FROM must be a plain email address (name@domain)',
    );
  }

  const resetLimit = parsePositiveInt(raw.PASSWORD_RESET_RATE_LIMIT, 5);
  if (resetLimit === undefined) {
    problems.push('PASSWORD_RESET_RATE_LIMIT must be a positive integer');
  }
  const resetWindow = parsePositiveInt(
    raw.PASSWORD_RESET_RATE_WINDOW_MS,
    60_000,
  );
  if (resetWindow === undefined) {
    problems.push('PASSWORD_RESET_RATE_WINDOW_MS must be a positive integer');
  }

  const corsOrigins: string[] = [];
  const rawCors = raw.CORS_ALLOWED_ORIGINS;
  if (rawCors !== undefined && rawCors !== null) {
    if (typeof rawCors !== 'string') {
      problems.push('CORS_ALLOWED_ORIGINS must be a comma-separated list');
    } else if (rawCors.trim().length > 0) {
      const items = rawCors.split(',').map((item) => item.trim());
      if (items.includes('*')) {
        if (items.length > 1) {
          problems.push(
            'CORS_ALLOWED_ORIGINS must not mix * with other origins',
          );
        } else if (nodeEnv === 'production') {
          problems.push(
            'CORS_ALLOWED_ORIGINS must not be * when NODE_ENV is production',
          );
        } else {
          corsOrigins.push('*');
        }
      } else {
        for (const item of items) {
          const origin = parseOrigin(item);
          if (!origin) {
            problems.push(
              'CORS_ALLOWED_ORIGINS must be comma-separated absolute http(s) origins without path',
            );
            break;
          }
          if (!corsOrigins.includes(origin.origin)) {
            corsOrigins.push(origin.origin);
          }
        }
      }
    }
  }

  const rawCorsAge = raw.CORS_MAX_AGE_SECONDS;
  const corsMaxAge =
    rawCorsAge === undefined || rawCorsAge === null ? 600 : Number(rawCorsAge);
  if (
    typeof rawCorsAge === 'boolean' ||
    (typeof rawCorsAge === 'string' && rawCorsAge.trim() === '') ||
    !Number.isInteger(corsMaxAge) ||
    corsMaxAge < 0 ||
    corsMaxAge > 86_400
  ) {
    problems.push(
      'CORS_MAX_AGE_SECONDS must be an integer between 0 and 86400',
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnv,
    PORT: port,
    TRUST_PROXY_HOPS: hops,
    DB_HOST: dbSettings.DB_HOST,
    DB_PORT: dbPort,
    DB_USER: dbSettings.DB_USER,
    DB_PASSWORD: dbSettings.DB_PASSWORD,
    DB_NAME: dbSettings.DB_NAME,
    FIREBASE_PROJECT_ID: projectId as string,
    FIREBASE_CREDENTIALS_JSON: credentials,
    FIREBASE_AUTH_EMULATOR_HOST: emulatorHost,
    CONSENT_TERMS_VERSIONS: termsVersions as string[],
    CONSENT_PRIVACY_VERSIONS: privacyVersions as string[],
    APP_BASE_URL: (appBase as URL).origin,
    CORS_ALLOWED_ORIGINS: corsOrigins,
    CORS_MAX_AGE_SECONDS: corsMaxAge,
    RESEND_API_KEY: (resendKey as string).trim(),
    PASSWORD_RESET_EMAIL_FROM: (resetFrom as string).trim(),
    PASSWORD_RESET_RATE_LIMIT: resetLimit as number,
    PASSWORD_RESET_RATE_WINDOW_MS: resetWindow as number,
  };
}
