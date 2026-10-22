import {
  ArgumentsHost,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ConflictError,
  IncompleteIdentityError,
  ValidationFailedError,
} from '../../shared/domain-error';
import { ProblemDetailsFilter } from './problem-details.filter';
import { RequestValidationException } from './request-validation.exception';

function run(exception: unknown, url = '/api/v1/users?token=secret') {
  const response = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  new ProblemDetailsFilter().catch(exception, host);

  return {
    status: response.status.mock.calls[0][0] as number,
    contentType: response.type.mock.calls[0][0] as string,
    body: response.send.mock.calls[0][0] as Record<string, unknown>,
  };
}

describe('ProblemDetailsFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('maps a domain error through its stable code', () => {
    const { status, contentType, body } = run(
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
    });
  });

  it.each([
    [new ValidationFailedError('bad'), 422, 'validation-failed'],
    [new IncompleteIdentityError('no email'), 403, 'incomplete-identity'],
    [new NotFoundException(), 404, 'not-found'],
    [new ForbiddenException(), 403, 'forbidden'],
  ])('maps %p to %i %s', (error, status, name) => {
    const result = run(error);

    expect(result.status).toBe(status);
    expect(result.body.type).toBe(`/problems/${name}`);
  });

  it('adds per-field errors for request validation failures', () => {
    const { status, body } = run(
      new RequestValidationException([{ field: 'email', reason: 'isEmail' }]),
    );

    expect(status).toBe(422);
    expect(body.errors).toEqual([{ field: 'email', reason: 'isEmail' }]);
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
      instance: '/api/v1/users',
    });
  });
});
