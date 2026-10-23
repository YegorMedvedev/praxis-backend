import type { Language } from './language';
import type { Message } from './message';

/**
 * What the generator needs to produce the patient's next message.
 *
 * `history` is the stored transcript BEFORE `pending`, oldest first, and does
 * not contain it. `pending` is the therapist message to answer, or null when
 * the opening message is requested (then `history` is empty).
 */
export interface ReplyRequest {
  session: {
    id: string;
    language: Language;
    /** Resolved at session creation. */
    agentId: string;
    /** The remote conversation kept for this session, if one exists. */
    openaiSessionId: string | null;
    /**
     * False when the remote conversation may differ from our transcript: an
     * earlier generation ended without completing, so the remote side may
     * have received input we never answered. The adapter then must not reuse
     * `openaiSessionId`; it starts a new remote conversation and replays
     * `history` plus `pending` into it (spec 07 "Recovery").
     */
    remoteInSync: boolean;
  };
  history: readonly Message[];
  pending: Message | null;
}

/**
 * What a generator yields, in order:
 *
 * 1. `remote-session`, as soon as the remote conversation id is known and
 *    BEFORE any `text`. The application persists it (and queues the previous
 *    remote conversation for deletion when it differs). The adapter may
 *    repeat the current id or skip the chunk when it reused the session.
 * 2. zero or more `text` deltas, forwarded to the client as they arrive.
 * 3. exactly one `completed`. A stream that ends without it is a failure.
 */
export type ReplyChunk =
  | { kind: 'remote-session'; openaiSessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'completed' };

/**
 * Port: produces the patient's reply. The application layer owns time-outs,
 * the length bound, event ordering, single-flight, persistence of the remote
 * conversation state (`openai_session_id`, `remote_in_sync`) and storing the
 * message. The adapter owns only talking to the model.
 *
 * - Failures reject with `ReplyGenerationFailedError` (any other error is
 *   treated the same, by class name only). `ServiceUnavailableError` means
 *   the dependency is down. Messages must never carry provider text, prompts
 *   or transcript content.
 * - When `signal` aborts, the generator must stop promptly (end or throw) and
 *   release the remote stream; it should best-effort cancel the remote turn.
 *   Its outcome is ignored after an abort.
 * - `remote_in_sync` is set to false by the application before the generator
 *   is called and back to true only when the reply is stored, so a failure,
 *   time-out, disconnect or cancel always leaves it false.
 */
export interface PatientReplyGenerator {
  generate(
    request: ReplyRequest,
    signal: AbortSignal,
  ): AsyncIterable<ReplyChunk>;
}
