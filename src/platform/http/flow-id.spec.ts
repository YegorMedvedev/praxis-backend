import type { Request, Response } from 'express';
import { flowIdMiddleware, resolveFlowId } from './flow-id';

describe('resolveFlowId', () => {
  const generate = () => 'generated';

  it.each(['abc-123', 'A.b_c-9', 'x'.repeat(128)])(
    'keeps valid id %s',
    (id) => {
      expect(resolveFlowId(id, generate)).toBe(id);
    },
  );

  it.each([undefined, '', 'x'.repeat(129), 'has space', 'a/b', 'é', ['a']])(
    'generates a new id for %p',
    (id) => {
      expect(resolveFlowId(id, generate)).toBe('generated');
    },
  );
});

describe('flowIdMiddleware', () => {
  it('stores the id on the response and echoes it as a header', () => {
    const response = {
      locals: {},
      setHeader: jest.fn(),
    } as unknown as Response;
    const request = { header: () => 'abc-123' } as unknown as Request;
    const next = jest.fn();

    flowIdMiddleware()(request, response, next);

    expect(response.locals.flowId).toBe('abc-123');
    expect(response.setHeader).toHaveBeenCalledWith('X-Flow-ID', 'abc-123');
    expect(next).toHaveBeenCalledWith();
  });
});
