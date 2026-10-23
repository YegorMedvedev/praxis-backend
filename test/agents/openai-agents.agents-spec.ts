/**
 * OPT-IN smoke test against the REAL OpenAI Agents API (spec 07 AC-9).
 *
 *   OPENAI_API_KEY=... SMOKE_AGENT_ID_EN=agent_... SMOKE_AGENT_ID_RU=agent_... \
 *     pnpm test:agents
 *
 * It is excluded from `pnpm test:all` and CI, and every language is skipped
 * unless the key and that language's agent id are set. It is run by the
 * product owner, never by an automated agent. It makes real, billable calls:
 * per language it opens one remote session, sends two therapist messages,
 * asserts each reply is non-empty, prints (never asserts) whether the reply
 * language looks right and the time to first delta, and deletes the remote
 * session afterwards. It never prints reply text.
 */
import type { Message } from '../../src/modules/chat-simulation/domain/message';
import type {
  ReplyChunk,
  ReplyRequest,
} from '../../src/modules/chat-simulation/domain/patient-reply-generator';
import { OpenAiPatientReplyGenerator } from '../../src/modules/chat-simulation/infrastructure/remote/openai-patient-reply-generator';
import { OpenAiRemoteSessionRemover } from '../../src/modules/chat-simulation/infrastructure/remote/openai-remote-session-remover';
import { createOpenAiAgentsClient } from '../../src/modules/chat-simulation/infrastructure/remote/sdk-openai-agents-client';

const apiKey = process.env.OPENAI_API_KEY;
const agents = {
  en: process.env.SMOKE_AGENT_ID_EN,
  ru: process.env.SMOKE_AGENT_ID_RU,
} as const;

const THERAPIST_MESSAGES: Record<'en' | 'ru', [string, string]> = {
  en: [
    '[smoke test] Hello. How are you feeling today?',
    '[smoke test] Can you tell me more about that?',
  ],
  ru: [
    '[smoke test] Здравствуйте. Как вы себя сегодня чувствуете?',
    '[smoke test] Расскажите, пожалуйста, подробнее.',
  ],
};

function message(id: string, role: Message['role'], text: string): Message {
  return { id, sessionId: 'smoke', role, text, createdAt: new Date() };
}

async function collect(
  generator: OpenAiPatientReplyGenerator,
  request: ReplyRequest,
): Promise<{ text: string; remoteSessionId?: string; firstDeltaMs?: number }> {
  const started = Date.now();
  let text = '';
  let remoteSessionId: string | undefined;
  let firstDeltaMs: number | undefined;
  let completed = false;
  for await (const chunk of generator.generate(
    request,
    new AbortController().signal,
  ) as AsyncIterable<ReplyChunk>) {
    if (chunk.kind === 'remote-session')
      remoteSessionId = chunk.openaiSessionId;
    if (chunk.kind === 'text') {
      firstDeltaMs ??= Date.now() - started;
      text += chunk.text;
    }
    if (chunk.kind === 'completed') completed = true;
  }
  expect(completed).toBe(true);
  return { text, remoteSessionId, firstDeltaMs };
}

describe.each(['en', 'ru'] as const)(
  'OpenAI Agents smoke test (%s)',
  (language) => {
    const agentId = agents[language];
    const enabled = Boolean(apiKey && agentId);
    const run = enabled ? it : it.skip;

    run(
      'opens a session, exchanges two messages, streams non-empty replies and cleans up',
      async () => {
        const client = createOpenAiAgentsClient(apiKey as string);
        const generator = new OpenAiPatientReplyGenerator(client);
        const remover = new OpenAiRemoteSessionRemover(client);
        let remoteSessionId: string | undefined;
        try {
          const history: Message[] = [];
          const base = { id: 'smoke', language, agentId: agentId as string };

          const opening = await collect(generator, {
            session: { ...base, openaiSessionId: null, remoteInSync: true },
            history,
            pending: null,
          });
          remoteSessionId = opening.remoteSessionId;
          expect(remoteSessionId).toBeTruthy();
          expect(opening.text.trim().length).toBeGreaterThan(0);
          history.push(message('p0', 'PATIENT', opening.text));

          let lastReply = opening.text;
          for (const [index, therapistText] of THERAPIST_MESSAGES[
            language
          ].entries()) {
            const pending = message(
              `t${index + 1}`,
              'THERAPIST',
              therapistText,
            );
            const reply = await collect(generator, {
              session: {
                ...base,
                openaiSessionId: remoteSessionId as string,
                remoteInSync: true,
              },
              history: [...history],
              pending,
            });
            expect(reply.text.trim().length).toBeGreaterThan(0);
            history.push(
              pending,
              message(`p${index + 1}`, 'PATIENT', reply.text),
            );
            lastReply = reply.text;
            console.log(
              `[smoke ${language}] reply ${index + 1}: time to first delta ${reply.firstDeltaMs ?? 'n/a'} ms`,
            );
          }

          const cyrillic = (lastReply.match(/[Ѐ-ӿ]/g) ?? []).length;
          const letters = (lastReply.match(/\p{L}/gu) ?? []).length || 1;
          const looksRussian = cyrillic / letters > 0.5;
          console.log(
            `[smoke ${language}] reply language matches session language: ${looksRussian === (language === 'ru')}`,
          );
        } finally {
          if (remoteSessionId) await remover.remove(remoteSessionId);
        }
      },
    );
  },
);
