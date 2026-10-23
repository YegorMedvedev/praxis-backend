import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AccountDisabledError,
  CaseNotFoundError,
  ConflictError,
  IncompleteIdentityError,
  InvalidRequestError,
  ProfileNotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../shared/domain-error';
import { ProblemDetailsFilter } from './problem-details.filter';
import type { RouteMethods } from './route-methods';

interface RunOptions {
  url?: string;
  method?: string;
  allowed?: string[];
}

function run(exception: unknown, options: RunOptions = {}) {
  const url = options.url ?? '/api/v1/users?token=secret';
  const headers: Record<string, string> = {};
  const response = {
    locals: { flowId: 'flow-1' },
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        originalUrl: url,
        path: url.split('?')[0],
        method: options.method ?? 'GET',
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  const routes = {
    allowedFor: () => options.allowed ?? [],
  } as unknown as RouteMethods;

  new ProblemDetailsFilter(routes).catch(exception, host);

  return {
    status: response.status.mock.calls[0][0] as number,
    contentType: response.type.mock.calls[0][0] as string,
    body: response.send.mock.calls[0][0] as Record<string, unknown>,
    headers,
  };
}

describe('ProblemDetailsFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('maps a domain error through its stable code and adds flow_id', () => {
    const { status, contentType, body, headers } = run(
      new ConflictError('email already registered'),
    );

    expect(status).toBe(409);
    expect(contentType).toBe('application/problem+json');
    expect(body).toEqual({
      type: '/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'email already registered',
      instance: '/api/v1/users',
      flow_id: 'flow-1',
    });
    expect(headers['X-Flow-ID']).toBe('flow-1');
  });

  it.each([
    [new ValidationFailedError('bad'), 422, 'validation-failed'],
    [new IncompleteIdentityError('no email'), 403, 'incomplete-identity'],
    [new AccountDisabledError('disabled'), 403, 'account-disabled'],
    [new ProfileNotFoundError('none'), 404, 'profile-not-found'],
    [new CaseNotFoundError('none'), 404, 'case-not-found'],
    [new InvalidRequestError('bad'), 400, 'invalid-request'],
    [new ServiceUnavailableError('down'), 503, 'service-unavailable'],
    [new NotFoundException(), 404, 'not-found'],
    [new ForbiddenException(), 403, 'forbidden'],
    [new BadRequestException(), 400, 'invalid-request'],
    [new ServiceUnavailableException(), 503, 'service-unavailable'],
  ])('maps %p to %i %s', (error, status, name) => {
    const result = run(error);

    expect(result.status).toBe(status);
    expect(result.body.type).toBe(`/problems/${name}`);
  });

  describe('401 problems', () => {
    const unauthenticated = run(new UnauthenticatedError('bad signature'));
    const expired = run(new TokenExpiredError('expired at 12:00'));

    it('carry WWW-Authenticate: Bearer', () => {
      expect(unauthenticated.headers['WWW-Authenticate']).toBe('Bearer');
      expect(expired.headers['WWW-Authenticate']).toBe('Bearer');
    });

    it('differ only in type and reveal no reason', () => {
      expect(unauthenticated.status).toBe(401);
      expect(expired.status).toBe(401);
      expect(unauthenticated.body.type).toBe('/problems/unauthenticated');
      expect(expired.body.type).toBe('/problems/token-expired');
      expect({ ...unauthenticated.body, type: 'x' }).toEqual({
        ...expired.body,
        type: 'x',
      });
      expect(JSON.stringify(expired.body)).not.toContain('12:00');
    });
  });

  it('adds Retry-After to rate-limited problems', () => {
    const { status, body, headers } = run(
      new RateLimitedError('slow down', 42),
    );

    expect(status).toBe(429);
    expect(body.type).toBe('/problems/rate-limited');
    expect(headers['Retry-After']).toBe('42');
  });

  it('adds invalid_params with name and reason only', () => {
    const { status, body } = run(
      new InvalidRequestError('invalid body', [
        { name: 'name', reason: 'TOO_SHORT' },
        { name: 'consent', reason: 'REQUIRED' },
      ]),
    );

    expect(status).toBe(400);
    expect(body.invalid_params).toEqual([
      { name: 'name', reason: 'TOO_SHORT' },
      { name: 'consent', reason: 'REQUIRED' },
    ]);
  });

  describe('framework statuses', () => {
    it('maps an undecodable case id to case-not-found, other paths stay 400', () => {
      const error = new BadRequestException(
        "Failed to decode param '%E0%A4%A'",
      );
      const caseId = run(error, { url: '/api/v1/cases/%E0%A4%A' });
      expect(caseId.status).toBe(404);
      expect(caseId.body.type).toBe('/problems/case-not-found');
      expect(run(error, { url: '/api/v1/users/%E0%A4%A' }).status).toBe(400);
    });

    it('turns a 404 into 405 with Allow when the path has other methods', () => {
      const { status, body, headers } = run(new NotFoundException(), {
        method: 'POST',
        allowed: ['GET', 'PUT'],
      });

      expect(status).toBe(405);
      expect(body.type).toBe('/problems/invalid-request');
      expect(headers.Allow).toBe('GET, PUT');
    });

    it('keeps a 404 when the method is allowed or the path is unknown', () => {
      expect(
        run(new NotFoundException(), { method: 'GET', allowed: ['GET'] })
          .status,
      ).toBe(404);
      expect(run(new NotFoundException()).status).toBe(404);
    });

    it('never turns HEAD into 405 when GET is allowed', () => {
      expect(
        run(new NotFoundException(), {
          method: 'HEAD',
          allowed: ['GET', 'PUT'],
        }).status,
      ).toBe(404);
    });

    it.each([406, 408, 410, 412, 431])(
      'keeps unmapped %i as a 4xx invalid-request',
      (code) => {
        const { status, body } = run(new HttpException('x', code));

        expect(status).toBe(code);
        expect(body.status).toBe(code);
        expect(body.type).toBe('/problems/invalid-request');
        expect(body.detail).toBe('The request could not be processed.');
      },
    );

    it('turns an unmapped 5xx into internal-error', () => {
      const { status, body } = run(new HttpException('x', 502));

      expect(status).toBe(500);
      expect(body.type).toBe('/problems/internal-error');
    });

    it.each([413, 415])(
      'maps %i to invalid-request with its real status',
      (code) => {
        const { status, body } = run(new HttpException('x', code));

        expect(status).toBe(code);
        expect(body.type).toBe('/problems/invalid-request');
        expect(body.status).toBe(code);
      },
    );

    it('maps an http-errors style error (body-parser) by its status', () => {
      const error = Object.assign(new Error('request entity too large'), {
        status: 413,
      });

      const { status, body } = run(error);

      expect(status).toBe(413);
      expect(JSON.stringify(body)).not.toContain('entity');
    });

    it('does not echo the message of a malformed-body error', () => {
      const { body } = run(new BadRequestException('Unexpected token s'));

      expect(JSON.stringify(body)).not.toContain('Unexpected');
    });
  });

  it('renders request validation failures as invalid-request with invalid_params', () => {
    const { status, body } = run(
      new InvalidRequestError('Request validation failed', [
        { name: 'name', reason: 'REQUIRED' },
      ]),
    );

    expect(status).toBe(400);
    expect(body.type).toBe('/problems/invalid-request');
    expect(body.invalid_params).toEqual([{ name: 'name', reason: 'REQUIRED' }]);
    expect(body).not.toHaveProperty('errors');
  });

  it('marks every problem response as not cacheable', () => {
    expect(run(new ConflictError('x')).headers['Cache-Control']).toBe(
      'no-store',
    );
  });

  it('hides internals of unexpected errors and drops the query string', () => {
    const { status, body } = run(
      new Error('select * from users where password = ...'),
    );

    expect(status).toBe(500);
    expect(body).toEqual({
      type: '/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      instance: '/api/v1/users',
      flow_id: 'flow-1',
    });
  });
});
