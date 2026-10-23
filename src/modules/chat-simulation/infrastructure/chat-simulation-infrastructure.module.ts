import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '../../../platform/config/app-config';
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
import { OpenAiPatientReplyGenerator } from './remote/openai-patient-reply-generator';
import { OpenAiRemoteSessionRemover } from './remote/openai-remote-session-remover';
import type { OpenAiAgentsClient } from './remote/openai-agents-client';
import { OPENAI_AGENTS_CLIENT } from './remote/openai.tokens';
import { createOpenAiAgentsClient } from './remote/sdk-openai-agents-client';

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
    // The OpenAI adapters (task 07). Constructing the SDK client makes no
    // network call. Tests and e2e override PATIENT_REPLY_GENERATOR and
    // REMOTE_SESSION_REMOVER with fakes and never reach OpenAI.
    {
      provide: OPENAI_AGENTS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createOpenAiAgentsClient(config.get('OPENAI_API_KEY', { infer: true })),
    },
    {
      provide: REMOTE_SESSION_REMOVER,
      inject: [OPENAI_AGENTS_CLIENT],
      useFactory: (client: OpenAiAgentsClient) =>
        new OpenAiRemoteSessionRemover(client),
    },
    {
      provide: PATIENT_REPLY_GENERATOR,
      inject: [OPENAI_AGENTS_CLIENT],
      useFactory: (client: OpenAiAgentsClient) =>
        new OpenAiPatientReplyGenerator(client),
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
