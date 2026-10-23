import { createOpenAiAgentsClient } from './sdk-openai-agents-client';

/**
 * Exercises the real SDK wrapper against an injected fake `fetch`: no network
 * and a dummy key. It pins the request shapes the adapter relies on (the
 * saved agent is selected with `agent_id`, no overrides, `environment: none`,
 * subscribe before send, idempotency key, cancel event).
 */
interface Recorded {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

function sse(events: object[]): Response {
  const body = events
    .map(
      (e) =>
        `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`,
    )
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function harness(respond: (r: Recorded) => Response) {
  const requests: Recorded[] = [];
  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const recorded: Recorded = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    };
    requests.push(recorded);
    return Promise.resolve(respond(recorded));
  };
  const client = createOpenAiAgentsClient('sk-dummy-not-a-real-key', {
    fetch: fakeFetch as typeof fetch,
  });
  return { client, requests };
}

describe('SdkOpenAiAgentsClient (fake fetch, no network)', () => {
  it('startSession selects the agent with agent_id, no overrides, environment none, streaming', async () => {
    const { client, requests } = harness(() =>
      sse([{ type: 'agent.session.created', session: { id: 'sess_1' } }]),
    );

    const stream = await client.startSession({
      agentId: 'agent_x',
      input: 'hello',
      signal: new AbortController().signal,
    });
    const seen: string[] = [];
    for await (const event of stream) seen.push(event.type);

    expect(seen).toEqual(['agent.session.created']);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toEqual({
      agent_id: 'agent_x',
      environment: { type: 'none' },
      input: 'hello',
      stream: true,
    });
    expect(requests[0].body).not.toHaveProperty('agent');
  });

  it('continueSession subscribes before it sends the input, with the idempotency key', async () => {
    const { client, requests } = harness((r) =>
      r.method === 'GET' && !r.path.endsWith('/events')
        ? new Response(JSON.stringify({ id: 'sess_1', status: 'idle' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : r.method === 'GET'
          ? sse([
              {
                event_id: 'e1',
                type: 'agent.session.idle',
                session: { id: 'sess_1' },
              },
              {
                event_id: 'e2',
                type: 'agent.session.turn.created',
                session_id: 'sess_1',
                turn_id: 't',
                turn: { subagent_id: null },
              },
              {
                event_id: 'e3',
                type: 'agent.session.turn.output_text.done',
                session_id: 'sess_1',
                text: 'Hi',
                output_index: 0,
                content_index: 0,
                turn_id: 't',
              },
              {
                event_id: 'e4',
                type: 'agent.session.turn.completed',
                session_id: 'sess_1',
                turn_id: 't',
                turn: { subagent_id: null },
              },
              {
                event_id: 'e5',
                type: 'agent.session.idle',
                session: { id: 'sess_1' },
              },
            ])
          : new Response(null, { status: 202 }),
    );

    const seen: string[] = [];
    for await (const event of client.continueSession({
      sessionId: 'sess_1',
      text: 'therapist words',
      idempotencyKey: 'therapist-message-m1',
      signal: new AbortController().signal,
    })) {
      seen.push(event.type);
    }

    expect(
      requests.map((r) => `${r.method} ${r.path.split('/').pop()}`),
    ).toEqual(['GET sess_1', 'GET events', 'POST events']);
    expect(requests[2].body).toEqual({
      events: [
        {
          type: 'agent.session.input.message',
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'therapist words' }],
            },
          ],
        },
      ],
    });
    expect(requests[2].headers.get('idempotency-key')).toBe(
      'therapist-message-m1',
    );
    expect(seen).toContain('agent.session.turn.completed');
  });

  it('cancelTurn sends one agent.session.input.cancel event', async () => {
    const { client, requests } = harness(
      () => new Response(null, { status: 202 }),
    );

    await client.cancelTurn('sess_1');

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toContain('sess_1');
    expect(requests[0].body).toEqual({
      events: [{ type: 'agent.session.input.cancel' }],
    });
  });

  it('deleteSession deletes by id; a 404 surfaces as an error with status 404 and is not retried', async () => {
    const { client, requests } = harness(
      () =>
        new Response(
          JSON.stringify({ error: { message: 'MARKER-NOT-FOUND' } }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );

    const failure = await client
      .deleteSession('sess_gone')
      .catch((e: unknown) => e);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('DELETE');
    expect((failure as { status?: number }).status).toBe(404);
  });

  it('does not retry a 500 on a streaming start (a retry could duplicate input)', async () => {
    const { client, requests } = harness(
      () =>
        new Response('{}', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await client
      .startSession({
        agentId: 'a',
        input: 'x',
        signal: new AbortController().signal,
      })
      .catch(() => undefined);

    expect(requests).toHaveLength(1);
  });

  it('never logs request content, even with OPENAI_LOG=debug in the environment', async () => {
    const MARKER = 'MARKER-TRANSCRIPT-3b9d';
    const previous = process.env.OPENAI_LOG;
    process.env.OPENAI_LOG = 'debug';
    const spies = (['debug', 'log', 'info', 'warn', 'error'] as const).map(
      (method) =>
        jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const { client } = harness(() =>
        sse([{ type: 'agent.session.created', session: { id: 'sess_1' } }]),
      );
      const stream = await client.startSession({
        agentId: 'agent_x',
        input: MARKER,
        signal: new AbortController().signal,
      });
      for await (const _event of stream) void _event;
      await client.deleteSession(MARKER).catch(() => undefined);

      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain(MARKER);
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      if (previous === undefined) delete process.env.OPENAI_LOG;
      else process.env.OPENAI_LOG = previous;
    }
  });

  it('always talks to the fixed OpenAI host, whatever OPENAI_BASE_URL says', async () => {
    const previous = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'https://attacker.example.test/v1';
    try {
      const urls: string[] = [];
      const client = createOpenAiAgentsClient('sk-dummy-not-a-real-key', {
        fetch: ((input: RequestInfo | URL) => {
          urls.push(input instanceof Request ? input.url : String(input));
          return Promise.resolve(new Response(null, { status: 202 }));
        }) as typeof fetch,
      });

      await client.cancelTurn('sess_1');

      expect(urls).toHaveLength(1);
      expect(new URL(urls[0]).host).toBe('api.openai.com');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previous;
    }
  });
});
