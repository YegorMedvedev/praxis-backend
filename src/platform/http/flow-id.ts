import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const FLOW_ID_HEADER = 'X-Flow-ID';

const VALID_FLOW_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Uses the client's flow id when it is well-formed, else a generated one. */
export function resolveFlowId(
  header: unknown,
  generate: () => string = randomUUID,
): string {
  if (typeof header === 'string' && VALID_FLOW_ID.test(header)) {
    return header;
  }
  return generate();
}

/** The flow id of the current request; set by `flowIdMiddleware`. */
export function flowIdOf(response: Response): string | undefined {
  const value: unknown = response.locals?.flowId;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Must be the first middleware: it makes the id available to logging and to
 * the problem filter, and echoes it on every response, errors included.
 */
export function flowIdMiddleware(generate: () => string = randomUUID) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const flowId = resolveFlowId(request.header(FLOW_ID_HEADER), generate);
    response.locals.flowId = flowId;
    response.setHeader(FLOW_ID_HEADER, flowId);
    next();
  };
}
