import { InMemoryPatientAgentDirectory, makeCase } from './fakes';
import { ResolvePatientAgent } from './resolve-patient-agent';

describe('ResolvePatientAgent', () => {
  const build = (directory: InMemoryPatientAgentDirectory) =>
    new ResolvePatientAgent(directory);

  it('returns two different ids for en and ru of a visible case', async () => {
    const directory = new InMemoryPatientAgentDirectory([makeCase('c1')], {
      c1: { en: 'agent_a', ru: 'agent_b' },
    });
    const useCase = build(directory);
    await expect(
      useCase.execute({ caseId: 'c1', language: 'en' }),
    ).resolves.toEqual({ agentId: 'agent_a' });
    await expect(
      useCase.execute({ caseId: 'c1', language: 'ru' }),
    ).resolves.toEqual({ agentId: 'agent_b' });
  });

  it('returns null for a hidden case even with an id', async () => {
    const hidden = makeCase('c1', {
      content: {
        en: {
          title: 't',
          teaser: 't',
          scenario: 's',
          patientName: 'p',
          contentNote: null,
        },
      },
    });
    const directory = new InMemoryPatientAgentDirectory([hidden], {
      c1: { en: 'agent_a' },
    });
    await expect(
      build(directory).execute({ caseId: 'c1', language: 'en' }),
    ).resolves.toBeNull();
  });

  it('returns null for a language without an id', async () => {
    const directory = new InMemoryPatientAgentDirectory([makeCase('c1')], {
      c1: { en: 'agent_a' },
    });
    await expect(
      build(directory).execute({ caseId: 'c1', language: 'ru' }),
    ).resolves.toBeNull();
  });

  it('returns null for unknown or malformed case ids without throwing', async () => {
    const directory = new InMemoryPatientAgentDirectory([makeCase('c1')], {
      c1: { en: 'agent_a' },
    });
    for (const caseId of ['missing', '', '\u0000', 'x'.repeat(5000)]) {
      await expect(
        build(directory).execute({ caseId, language: 'en' }),
      ).resolves.toBeNull();
    }
  });
});
