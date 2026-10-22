export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  NODE_ENV: NodeEnv;
  PORT: number;
  /** Number of trusted reverse-proxy hops in front of the app; 0 trusts none. */
  TRUST_PROXY_HOPS: number;
  DATABASE_URL: string;
  FIREBASE_PROJECT_ID: string;
  /** Raw service-account JSON (a secret); absent means Application Default Credentials. */
  FIREBASE_CREDENTIALS_JSON?: string;
  /** host:port of the Firebase Auth emulator; never allowed in production. */
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  /** Recognised Terms of Service version identifiers (comma-separated in env). */
  CONSENT_TERMS_VERSIONS: string[];
  /** Recognised Privacy Policy version identifiers (comma-separated in env). */
  CONSENT_PRIVACY_VERSIONS: string[];
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

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    problems.push('DATABASE_URL is required');
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

  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnv,
    PORT: port,
    TRUST_PROXY_HOPS: hops,
    DATABASE_URL: databaseUrl as string,
    FIREBASE_PROJECT_ID: projectId as string,
    FIREBASE_CREDENTIALS_JSON: credentials,
    FIREBASE_AUTH_EMULATOR_HOST: emulatorHost,
    CONSENT_TERMS_VERSIONS: termsVersions as string[],
    CONSENT_PRIVACY_VERSIONS: privacyVersions as string[],
  };
}
