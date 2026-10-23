import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import {
  PATIENT_REPLY_GENERATOR,
  REMOTE_SESSION_REMOVER,
} from '../chat-simulation.tokens';
import { ChatSimulationInfrastructureModule } from './chat-simulation-infrastructure.module';
import { FakeOpenAiAgentsClient } from './remote/fake-openai-agents-client';
import { OpenAiPatientReplyGenerator } from './remote/openai-patient-reply-generator';
import { OpenAiRemoteSessionRemover } from './remote/openai-remote-session-remover';
import { OPENAI_AGENTS_CLIENT } from './remote/openai.tokens';

interface FactoryProvider {
  provide: symbol;
  inject?: unknown[];
  useFactory?: (...args: unknown[]) => unknown;
  useValue?: unknown;
  useClass?: unknown;
}

const providers = (
  Reflect.getMetadata(
    'providers',
    ChatSimulationInfrastructureModule,
  ) as FactoryProvider[]
).filter((p): p is FactoryProvider => typeof p === 'object');

function bound(token: symbol): FactoryProvider {
  const found = providers.filter((p) => p.provide === token);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('production composition of the OpenAI adapters', () => {
  it('binds the real OpenAI generator, not a placeholder', () => {
    const provider = bound(PATIENT_REPLY_GENERATOR);

    expect(provider.useValue).toBeUndefined();
    expect(provider.inject).toEqual([OPENAI_AGENTS_CLIENT]);
    expect(provider.useFactory?.(new FakeOpenAiAgentsClient())).toBeInstanceOf(
      OpenAiPatientReplyGenerator,
    );
  });

  it('binds the real OpenAI remover, not a placeholder', () => {
    const provider = bound(REMOTE_SESSION_REMOVER);

    expect(provider.useValue).toBeUndefined();
    expect(provider.inject).toEqual([OPENAI_AGENTS_CLIENT]);
    expect(provider.useFactory?.(new FakeOpenAiAgentsClient())).toBeInstanceOf(
      OpenAiRemoteSessionRemover,
    );
  });

  it('builds the SDK client from the OPENAI_API_KEY config value without a network call', () => {
    const provider = bound(OPENAI_AGENTS_CLIENT);
    const config = {
      get: (name: string) =>
        name === 'OPENAI_API_KEY' ? 'sk-dummy' : undefined,
    };

    const client = provider.useFactory?.(config) as { startSession?: unknown };

    expect(typeof client.startSession).toBe('function');
  });

  it('no placeholder implementation remains in the infrastructure sources', () => {
    const files = readdirSync(`${__dirname}/remote`);

    expect(files.filter((f) => f.startsWith('unconfigured'))).toEqual([]);
  });
});
