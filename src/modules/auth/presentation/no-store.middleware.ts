import type { NextFunction, Request, Response } from 'express';

/** Reset requests carry an email address: no cache may keep any response. */
export function noStoreMiddleware() {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  };
}
