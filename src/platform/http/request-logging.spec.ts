import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { requestLoggingMiddleware } from './request-logging';

function run(request: Partial<Request>, statusCode = 200) {
  const lines: string[] = [];
  const response = Object.assign(new EventEmitter(), {
    statusCode,
    locals: { flowId: 'flow-9' },
  }) as unknown as Response;
  let clock = 100;
  const middleware = requestLoggingMiddleware(
    { log: (line) => lines.push(line) },
    () => (clock += 12),
  );

  const next = jest.fn();
  middleware(request as Request, response, next);
  response.emit('finish');

  expect(next).toHaveBeenCalled();
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('requestLoggingMiddleware', () => {
  it('logs flow id, method, route template, status and latency', () => {
    const [entry] = run({
      method: 'PUT',
      route: { path: '/api/v1/me/:id' },
      originalUrl: '/api/v1/me/user-42?email=a@b.c',
      headers: { authorization: 'Bearer secret-token' },
    });

    expect(entry).toEqual({
      event: 'http_request',
      flow_id: 'flow-9',
      method: 'PUT',
      route: '/api/v1/me/:id',
      status: 200,
      latency_ms: 12,
    });
  });

  it('logs a placeholder for unmatched routes and never the raw URL', () => {
    const lines: string[] = [];
    const response = Object.assign(new EventEmitter(), {
      statusCode: 404,
      locals: { flowId: 'f' },
    }) as unknown as Response;
    requestLoggingMiddleware({ log: (l) => lines.push(l) })(
      {
        method: 'GET',
        originalUrl: '/secret-path?token=abc',
        headers: { authorization: 'Bearer abc' },
        body: { name: 'Elena', email: 'e@x.y', password: 'pw' },
      } as unknown as Request,
      response,
      jest.fn(),
    );
    response.emit('finish');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('(unmatched)');
    for (const forbidden of ['secret-path', 'abc', 'Elena', 'e@x.y', 'pw']) {
      expect(lines[0]).not.toContain(forbidden);
    }
  });
});
