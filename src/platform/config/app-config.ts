export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL: string;
}

const NODE_ENVS: readonly string[] = ['development', 'test', 'production'];

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

  const databaseUrl = raw.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    problems.push('DATABASE_URL is required');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid environment: ${problems.join('; ')}`);
  }

  return {
    NODE_ENV: nodeEnv as NodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl as string,
  };
}
