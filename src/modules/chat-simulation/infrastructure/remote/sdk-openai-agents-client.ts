import OpenAI from 'openai';
import type {
  AgentEventStream,
  AgentStreamEvent,
  OpenAiAgentsClient,
} from './openai-agents-client';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Bound on the short control calls (cancel, delete). */
const CONTROL_CALL_TIMEOUT_MS = 10_000;

/**
 * The real `OpenAiAgentsClient`, over the `openai` SDK's beta Agents API.
 *
 * - The saved agent is selected with `agent_id`; the installed SDK's
 *   `agent` object holds per-session overrides only (no `id`), and this
 *   adapter passes no overrides: the agent's saved instructions are
 *   authoritative.
 * - `environment: { type: 'none' }` is required by the SDK types.
 * - SDK retries are off (`maxRetries: 0`): a retry could duplicate input;
 *   retrying is the user's decision ("Try again").
 * - SDK logging is forced off (`logLevel: 'off'`) and the base URL is fixed.
 */
export class SdkOpenAiAgentsClient implements OpenAiAgentsClient {
  constructor(private readonly sdk: OpenAI) {}

  async startSession(request: {
    agentId: string;
    input: string;
    signal: AbortSignal;
  }): Promise<AgentEventStream> {
    const stream = await this.sdk.beta.agents.sessions.create(
      {
        agent_id: request.agentId,
        environment: { type: 'none' },
        input: request.input,
        stream: true,
      },
      { signal: request.signal, maxRetries: 0 },
    );
    return (async function* (): AsyncGenerator<AgentStreamEvent> {
      try {
        for await (const event of stream) yield event;
      } finally {
        stream.controller.abort();
      }
    })();
  }

  continueSession(request: {
    sessionId: string;
    text: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): AgentEventStream {
    const sdk = this.sdk;
    return (async function* (): AsyncGenerator<AgentStreamEvent> {
      // `stream()` subscribes to the session's events before it sends the
      // input, and sends it with the idempotency key.
      const stream = sdk.beta.agents.sessions.stream(
        request.sessionId,
        { input: request.text, idempotencyKey: request.idempotencyKey },
        { signal: request.signal, maxRetries: 0 },
      );
      try {
        for await (const event of stream) yield event;
      } finally {
        stream.abort();
      }
    })();
  }

  async cancelTurn(sessionId: string): Promise<void> {
    await this.sdk.beta.agents.sessions.events.create(
      sessionId,
      { events: [{ type: 'agent.session.input.cancel' }] },
      { timeout: CONTROL_CALL_TIMEOUT_MS, maxRetries: 0 },
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sdk.beta.agents.sessions.delete(sessionId, {
      timeout: CONTROL_CALL_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
}

/** Builds the SDK client. `fetch` is injectable for tests (no network). */
export function createOpenAiAgentsClient(
  apiKey: string,
  options: { fetch?: typeof fetch } = {},
): OpenAiAgentsClient {
  return new SdkOpenAiAgentsClient(
    new OpenAI({
      apiKey,
      // Fixed on purpose: stray OPENAI_BASE_URL / OPENAI_ORG_ID /
      // OPENAI_PROJECT_ID / OPENAI_LOG variables must not redirect the key
      // and transcripts or turn on request-body logging.
      baseURL: OPENAI_BASE_URL,
      organization: null,
      project: null,
      logLevel: 'off',
      maxRetries: 0,
      fetch: options.fetch,
    }),
  );
}
