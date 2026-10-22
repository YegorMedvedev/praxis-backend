import type { NextFunction, Request, Response } from 'express';
import { flowIdOf } from './flow-id';

export interface LogSink {
  log(message: string): void;
}

export const UNMATCHED_ROUTE = '(unmatched)';

/**
 * One structured line per request. Only non-sensitive facts are read: flow id,
 * method, the route TEMPLATE (never the raw URL, which carries ids and query
 * strings), status and latency. Headers, query strings and bodies are never
 * touched, so tokens, passwords, names and emails cannot reach the log.
 */
export function requestLoggingMiddleware(
  sink: LogSink,
  now: () => number = () => performance.now(),
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = now();
    response.on('finish', () => {
      const template: unknown = request.route?.path;
      sink.log(
        JSON.stringify({
          event: 'http_request',
          flow_id: flowIdOf(response),
          method: request.method,
          route: typeof template === 'string' ? template : UNMATCHED_ROUTE,
          status: response.statusCode,
          latency_ms: Math.round(now() - startedAt),
        }),
      );
    });
    next();
  };
}
