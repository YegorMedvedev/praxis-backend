import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseLibraryModule } from '../../case-library/case-library.public-api';
import {
  CASE_AGENT_DIRECTORY,
  CASE_COMPLETION_RECORDER,
  REMOTE_SESSION_DELETION_QUEUE,
  REMOTE_SESSION_REMOVER,
  SESSION_GENERATION_CANCELLER,
  SESSION_REPOSITORY,
  UNIT_OF_WORK,
} from '../chat-simulation.tokens';
import {
  CaseLibraryAgentDirectory,
  CaseLibraryCompletionRecorder,
} from './case-library-adapters';
import { AgentSessionDeletionOrmEntity } from './persistence/agent-session-deletion.orm-entity';
import { SessionOrmEntity } from './persistence/session.orm-entity';
import { TypeOrmSessionDeletionQueue } from './persistence/typeorm-session-deletion-queue';
import { TypeOrmSessionRepository } from './persistence/typeorm-session.repository';
import { TypeOrmUnitOfWork } from './persistence/typeorm-unit-of-work';
import { NoActiveGenerations } from './remote/no-active-generations';
import { UnconfiguredRemoteSessionRemover } from './remote/unconfigured-remote-session-remover';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionOrmEntity, AgentSessionDeletionOrmEntity]),
    CaseLibraryModule,
  ],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: TypeOrmSessionRepository },
    { provide: UNIT_OF_WORK, useClass: TypeOrmUnitOfWork },
    {
      provide: REMOTE_SESSION_DELETION_QUEUE,
      useClass: TypeOrmSessionDeletionQueue,
    },
    { provide: CASE_AGENT_DIRECTORY, useClass: CaseLibraryAgentDirectory },
    {
      provide: CASE_COMPLETION_RECORDER,
      useClass: CaseLibraryCompletionRecorder,
    },
    // Placeholders, replaced by tasks 07 (real OpenAI remover) and 02
    // (in-process generation registry).
    {
      provide: REMOTE_SESSION_REMOVER,
      useValue: new UnconfiguredRemoteSessionRemover(),
    },
    {
      provide: SESSION_GENERATION_CANCELLER,
      useValue: new NoActiveGenerations(),
    },
  ],
  exports: [
    SESSION_REPOSITORY,
    UNIT_OF_WORK,
    REMOTE_SESSION_DELETION_QUEUE,
    CASE_AGENT_DIRECTORY,
    CASE_COMPLETION_RECORDER,
    REMOTE_SESSION_REMOVER,
    SESSION_GENERATION_CANCELLER,
  ],
})
export class ChatSimulationInfrastructureModule {}
