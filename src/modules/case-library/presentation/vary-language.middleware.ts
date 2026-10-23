import type { NextFunction, Request, Response } from 'express';

/** The body depends on `Accept-Language`, errors included. */
export function varyLanguageMiddleware() {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.vary('Accept-Language');
    next();
  };
}
