import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CLOCK, ID_GENERATOR } from '../../platform/system/system.tokens';
import type { Clock } from '../../shared/clock';
import type { IdGenerator } from '../../shared/id-generator';
import { CreateSession } from './application/create-session';
import { DiscardSession } from './application/discard-session';
import { EndSession } from './application/end-session';
import { GenerationRegistry } from './application/generation-registry';
import { GetSession } from './application/get-session';
import { ListMessages } from './application/list-messages';
import { ProcessSessionDeletions } from './application/process-session-deletions';
import { SendTherapistMessage } from './application/send-therapist-message';
import {
  DEFAULT_REPLY_TIMINGS,
  StreamPatientReply,
  type ReplyTimings,
} from './application/stream-patient-reply';
import {
  CASE_AGENT_DIRECTORY,
  CASE_COMPLETION_RECORDER,
  GENERATION_REGISTRY,
  MESSAGE_REPOSITORY,
  PATIENT_REPLY_GENERATOR,
  REMOTE_SESSION_DELETION_QUEUE,
  REMOTE_SESSION_REMOVER,
  REPLY_TIMINGS,
  SESSION_GENERATION_CANCELLER,
  SESSION_REPOSITORY,
  UNIT_OF_WORK,
} from './chat-simulation.tokens';
import type { CaseAgentDirectory } from './domain/case-agent-directory';
import type { CaseCompletionRecorder } from './domain/case-completion-recorder';
import type { MessageRepository } from './domain/message-repository';
import type { PatientReplyGenerator } from './domain/patient-reply-generator';
import type { RemoteSessionDeletionQueue } from './domain/remote-session-deletion-queue';
import type { RemoteSessionRemover } from './domain/remote-session-remover';
import type { SessionGenerationCanceller } from './domain/session-generation-canceller';
import type { SessionRepository } from './domain/session-repository';
import type { UnitOfWork } from './domain/unit-of-work';
import { ChatSimulationInfrastructureModule } from './infrastructure/chat-simulation-infrastructure.module';
import { SessionDeletionWorker } from './infrastructure/session-deletion-worker';
import { noStoreMiddleware } from './presentation/no-store.middleware';
import { MessagesController } from './presentation/messages.controller';
import { SessionsController } from './presentation/sessions.controller';

@Module({
  imports: [ChatSimulationInfrastructureModule],
  controllers: [SessionsController, MessagesController],
  providers: [
    // One in-process registry is both the single-flight guard of the reply
    // stream and the canceller used when a session ends or is discarded.
    {
      provide: GENERATION_REGISTRY,
      useFactory: () => new GenerationRegistry(),
    },
    {
      provide: SESSION_GENERATION_CANCELLER,
      useExisting: GENERATION_REGISTRY,
    },
    {
      provide: CreateSession,
      inject: [
        SESSION_REPOSITORY,
        CASE_AGENT_DIRECTORY,
        REMOTE_SESSION_DELETION_QUEUE,
        UNIT_OF_WORK,
        SESSION_GENERATION_CANCELLER,
        ID_GENERATOR,
        CLOCK,
      ],
      useFactory: (
        sessions: SessionRepository,
        agents: CaseAgentDirectory,
        deletions: RemoteSessionDeletionQueue,
        unitOfWork: UnitOfWork,
        canceller: SessionGenerationCanceller,
        ids: IdGenerator,
        clock: Clock,
      ) =>
        new CreateSession(
          sessions,
          agents,
          deletions,
          unitOfWork,
          canceller,
          ids,
          clock,
        ),
    },
    {
      provide: GetSession,
      inject: [SESSION_REPOSITORY],
      useFactory: (sessions: SessionRepository) => new GetSession(sessions),
    },
    {
      provide: EndSession,
      inject: [
        SESSION_REPOSITORY,
        CASE_COMPLETION_RECORDER,
        UNIT_OF_WORK,
        SESSION_GENERATION_CANCELLER,
        CLOCK,
      ],
      useFactory: (
        sessions: SessionRepository,
        completions: CaseCompletionRecorder,
        unitOfWork: UnitOfWork,
        canceller: SessionGenerationCanceller,
        clock: Clock,
      ) => new EndSession(sessions, completions, unitOfWork, canceller, clock),
    },
    {
      provide: DiscardSession,
      inject: [
        SESSION_REPOSITORY,
        REMOTE_SESSION_DELETION_QUEUE,
        UNIT_OF_WORK,
        SESSION_GENERATION_CANCELLER,
        CLOCK,
      ],
      useFactory: (
        sessions: SessionRepository,
        deletions: RemoteSessionDeletionQueue,
        unitOfWork: UnitOfWork,
        canceller: SessionGenerationCanceller,
        clock: Clock,
      ) =>
        new DiscardSession(sessions, deletions, unitOfWork, canceller, clock),
    },
    {
      provide: ProcessSessionDeletions,
      inject: [REMOTE_SESSION_DELETION_QUEUE, REMOTE_SESSION_REMOVER, CLOCK],
      useFactory: (
        queue: RemoteSessionDeletionQueue,
        remover: RemoteSessionRemover,
        clock: Clock,
      ) => new ProcessSessionDeletions(queue, remover, clock),
    },
    {
      provide: SendTherapistMessage,
      inject: [
        SESSION_REPOSITORY,
        MESSAGE_REPOSITORY,
        UNIT_OF_WORK,
        ID_GENERATOR,
        CLOCK,
      ],
      useFactory: (
        sessions: SessionRepository,
        messages: MessageRepository,
        unitOfWork: UnitOfWork,
        ids: IdGenerator,
        clock: Clock,
      ) => new SendTherapistMessage(sessions, messages, unitOfWork, ids, clock),
    },
    {
      provide: ListMessages,
      inject: [SESSION_REPOSITORY, MESSAGE_REPOSITORY],
      useFactory: (sessions: SessionRepository, messages: MessageRepository) =>
        new ListMessages(sessions, messages),
    },
    // Spec 02 FR-7 (15 s). A provider so tests can shorten the waits.
    { provide: REPLY_TIMINGS, useValue: DEFAULT_REPLY_TIMINGS },
    {
      provide: StreamPatientReply,
      inject: [
        SESSION_REPOSITORY,
        MESSAGE_REPOSITORY,
        PATIENT_REPLY_GENERATOR,
        GENERATION_REGISTRY,
        REMOTE_SESSION_DELETION_QUEUE,
        UNIT_OF_WORK,
        ID_GENERATOR,
        CLOCK,
        REPLY_TIMINGS,
      ],
      useFactory: (
        sessions: SessionRepository,
        messages: MessageRepository,
        generator: PatientReplyGenerator,
        registry: GenerationRegistry,
        deletions: RemoteSessionDeletionQueue,
        unitOfWork: UnitOfWork,
        ids: IdGenerator,
        clock: Clock,
        timings: ReplyTimings,
      ) =>
        new StreamPatientReply(
          sessions,
          messages,
          generator,
          registry,
          deletions,
          unitOfWork,
          ids,
          clock,
          timings,
        ),
    },
    SessionDeletionWorker,
  ],
})
export class ChatSimulationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(noStoreMiddleware())
      .forRoutes(SessionsController, MessagesController);
  }
}
