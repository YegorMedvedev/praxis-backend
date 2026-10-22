import type { NextFunction, Request, Response } from 'express';

/** Personal data: no cache may keep it, errors included. */
export function noStoreMiddleware() {
  return (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  };
}
