import type { Request } from 'express';
import { jsonContentTypeMiddleware } from './json-content-type';

function run(isResult: string | false | null, headers = {}) {
  const next = jest.fn();
  jsonContentTypeMiddleware()(
    { is: () => isResult, headers } as unknown as Request,
    {} as never,
    next,
  );
  return next;
}

describe('jsonContentTypeMiddleware', () => {
  it('passes JSON bodies and bodiless requests', () => {
    expect(run('json')).toHaveBeenCalledWith();
    expect(run(null)).toHaveBeenCalledWith();
  });

  it('treats Content-Length: 0 as no body', () => {
    expect(run(false, { 'content-length': '0' })).toHaveBeenCalledWith();
  });

  it('rejects a body in another content type with 415', () => {
    const next = run(false);

    const [error] = next.mock.calls[0] as [{ getStatus(): number }];
    expect(error.getStatus()).toBe(415);
  });
});
