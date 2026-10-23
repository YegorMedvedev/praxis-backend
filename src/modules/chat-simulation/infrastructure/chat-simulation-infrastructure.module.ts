import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseLibraryModule } from '../../case-library/case-library.public-api';
import {
  CASE_AGENT_DIRECTORY,
  CASE_COMPLETION_RECORDER,
  REMOTE_SESSION_DELETION_QUEUE,
  MESSAGE_REPOSITORY,
  PATIENT_REPLY_GENERATOR,
  REMOTE_SESSION_REMOVER,
  SESSION_REPOSITORY,
  UNIT_OF_WORK,
} from '../chat-simulation.tokens';
import {
  CaseLibraryAgentDirectory,
  CaseLibraryCompletionRecorder,
} from './case-library-adapters';
import { AgentSessionDeletionOrmEntity } from './persistence/agent-session-deletion.orm-entity';
import { MessageOrmEntity } from './persistence/message.orm-entity';
import { SessionOrmEntity } from './persistence/session.orm-entity';
import { TypeOrmMessageRepository } from './persistence/typeorm-message.repository';
import { TypeOrmSessionDeletionQueue } from './persistence/typeorm-session-deletion-queue';
import { TypeOrmSessionRepository } from './persistence/typeorm-session.repository';
import { TypeOrmUnitOfWork } from './persistence/typeorm-unit-of-work';
import { UnconfiguredPatientReplyGenerator } from './remote/unconfigured-patient-reply-generator';
import { UnconfiguredRemoteSessionRemover } from './remote/unconfigured-remote-session-remover';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SessionOrmEntity,
      MessageOrmEntity,
      AgentSessionDeletionOrmEntity,
    ]),
    CaseLibraryModule,
  ],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: TypeOrmSessionRepository },
    { provide: MESSAGE_REPOSITORY, useClass: TypeOrmMessageRepository },
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
    // Placeholders, both replaced by task 07 (the OpenAI adapters). Neither
    // fakes content: the remover fails (the worker retries) and the generator
    // fails every reply with `reply-generation-failed`.
    {
      provide: REMOTE_SESSION_REMOVER,
      useValue: new UnconfiguredRemoteSessionRemover(),
    },
    {
      provide: PATIENT_REPLY_GENERATOR,
      useValue: new UnconfiguredPatientReplyGenerator(),
    },
  ],
  exports: [
    SESSION_REPOSITORY,
    MESSAGE_REPOSITORY,
    UNIT_OF_WORK,
    REMOTE_SESSION_DELETION_QUEUE,
    CASE_AGENT_DIRECTORY,
    CASE_COMPLETION_RECORDER,
    REMOTE_SESSION_REMOVER,
    PATIENT_REPLY_GENERATOR,
  ],
})
export class ChatSimulationInfrastructureModule {}
