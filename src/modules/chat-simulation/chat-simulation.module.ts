import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CLOCK, ID_GENERATOR } from '../../platform/system/system.tokens';
import type { Clock } from '../../shared/clock';
import type { IdGenerator } from '../../shared/id-generator';
import { CreateSession } from './application/create-session';
import { DiscardSession } from './application/discard-session';
import { EndSession } from './application/end-session';
import { GetSession } from './application/get-session';
import { ProcessSessionDeletions } from './application/process-session-deletions';
import {
  CASE_AGENT_DIRECTORY,
  CASE_COMPLETION_RECORDER,
  REMOTE_SESSION_DELETION_QUEUE,
  REMOTE_SESSION_REMOVER,
  SESSION_GENERATION_CANCELLER,
  SESSION_REPOSITORY,
  UNIT_OF_WORK,
} from './chat-simulation.tokens';
import type { CaseAgentDirectory } from './domain/case-agent-directory';
import type { CaseCompletionRecorder } from './domain/case-completion-recorder';
import type { RemoteSessionDeletionQueue } from './domain/remote-session-deletion-queue';
import type { RemoteSessionRemover } from './domain/remote-session-remover';
import type { SessionGenerationCanceller } from './domain/session-generation-canceller';
import type { SessionRepository } from './domain/session-repository';
import type { UnitOfWork } from './domain/unit-of-work';
import { ChatSimulationInfrastructureModule } from './infrastructure/chat-simulation-infrastructure.module';
import { SessionDeletionWorker } from './infrastructure/session-deletion-worker';
import { noStoreMiddleware } from './presentation/no-store.middleware';
import { SessionsController } from './presentation/sessions.controller';

@Module({
  imports: [ChatSimulationInfrastructureModule],
  controllers: [SessionsController],
  providers: [
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
    SessionDeletionWorker,
  ],
})
export class ChatSimulationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware()).forRoutes(SessionsController);
  }
}
