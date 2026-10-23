/**
 * The small surface of the OpenAI Agents API this module uses. The real
 * implementation wraps the `openai` SDK (`sdk-openai-agents-client.ts`); every
 * automated test uses a fake of this interface, so CI never needs the network
 * or a key.
 *
 * Failures reject/throw. The adapters only read a numeric `status` (HTTP
 * status) and `requestID` from an error, plus its class name, and never
 * forward its message.
 */

/**
 * The part of an Agents API stream event the adapter reads. The SDK's
 * `AgentSessionEvent` union is structurally assignable to this; the fields
 * are the ones documented for the events in spec 07's mapping table.
 */
export interface AgentStreamEvent {
  type: string;
  /** Present on turn, text and error events. */
  session_id?: string;
  /** Present on `agent.session.created` / `.failed` / `.idle` events. */
  session?: { id: string } | null;
  turn_id?: string | null;
  delta?: string;
  text?: string;
  output_index?: number | null;
  content_index?: number | null;
  turn?: {
    subagent_id?: string | null;
    error?: { code?: string | null } | null;
  } | null;
  error?: { code?: string | null } | null;
}

/** A single-use stream of events. Ending it early releases the connection. */
export type AgentEventStream = AsyncIterable<AgentStreamEvent>;

export interface OpenAiAgentsClient {
  /**
   * Creates a remote session for a saved agent with the given first input and
   * streams its events. `signal` aborts the request and the stream.
   */
  startSession(request: {
    agentId: string;
    input: string;
    signal: AbortSignal;
  }): Promise<AgentEventStream>;

  /**
   * On an existing idle session: subscribes to the event stream, THEN sends
   * `text` as one `agent.session.input.message` with the idempotency key, and
   * yields the turn's events. Aborting `signal` closes the stream; it does not
   * cancel the remote turn (use `cancelTurn`).
   */
  continueSession(request: {
    sessionId: string;
    text: string;
    idempotencyKey: string;
    signal: AbortSignal;
  }): AgentEventStream;

  /** Sends `agent.session.input.cancel` for the session's active turn. */
  cancelTurn(sessionId: string): Promise<void>;

  /** Deletes a remote session (the API may finish cleanup asynchronously). */
  deleteSession(sessionId: string): Promise<void>;
}

/** HTTP status carried by an SDK/HTTP error, if any. */
export function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** Provider request id carried by an SDK error, if any (safe to log). */
export function requestIdOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const id = (error as { requestID?: unknown }).requestID;
  return typeof id === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(id)
    ? id
    : undefined;
}

/** Class name of an error value; never its message. */
export function errorClassOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { constructor?: { name?: unknown } }).constructor
      ?.name;
    if (typeof name === 'string' && /^[A-Za-z0-9_$]{1,60}$/.test(name)) {
      return name;
    }
  }
  return typeof error;
}
