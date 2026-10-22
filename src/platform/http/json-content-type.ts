import { HttpException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Maximum JSON body size (spec signup-login/06: 8 KiB). */
export const MAX_BODY_BYTES = 8 * 1024;

/**
 * Rejects a request that carries a body in a non-JSON content type with 415.
 * Without this the body parser would skip it and a handler would see no body.
 * The error is rendered by `ProblemDetailsFilter`.
 */
export function jsonContentTypeMiddleware() {
  return (request: Request, _response: Response, next: NextFunction): void => {
    // `is()` treats "Content-Length: 0" as a body; an empty body has no type.
    const empty =
      request.headers['content-length'] === '0' &&
      request.headers['transfer-encoding'] === undefined;
    // `is()` is null when there is no body, false when the type mismatches.
    if (!empty && request.is('json') === false) {
      next(new HttpException('Unsupported Media Type', 415));
      return;
    }
    next();
  };
}
