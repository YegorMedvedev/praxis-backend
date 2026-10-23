import { ReplyGenerationFailedError } from '../../../../shared/domain-error';
import type {
  PatientReplyGenerator,
  ReplyChunk,
} from '../../domain/patient-reply-generator';

/**
 * PLACEHOLDER until task 07 binds the OpenAI Agents adapter. It never
 * produces content: every reply fails as `reply-generation-failed`, so no
 * environment can mistake it for a working patient. Replace the
 * `PATIENT_REPLY_GENERATOR` binding in `ChatSimulationInfrastructureModule`.
 */
export class UnconfiguredPatientReplyGenerator implements PatientReplyGenerator {
  // eslint-disable-next-line require-yield
  async *generate(): AsyncGenerator<ReplyChunk> {
    await Promise.resolve();
    throw new ReplyGenerationFailedError('no reply generator is configured');
  }
}
