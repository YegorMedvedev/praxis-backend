import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CLOCK } from '../../platform/system/system.tokens';
import type { Clock } from '../../shared/clock';
import { GetCaseProgress } from './application/get-case-progress';
import { RecordCaseCompletion } from './application/record-case-completion';
import {
  CASE_CATALOG,
  CASE_COMPLETION_REPOSITORY,
} from './case-library.tokens';
import type { CaseCatalog } from './domain/case-catalog';
import type { CaseCompletionRepository } from './domain/case-completion';
import { CaseLibraryInfrastructureModule } from './infrastructure/case-library-infrastructure.module';
import { CaseProgressController } from './presentation/case-progress.controller';
import { noStoreMiddleware } from './presentation/no-store.middleware';

@Module({
  imports: [CaseLibraryInfrastructureModule],
  controllers: [CaseProgressController],
  providers: [
    {
      provide: GetCaseProgress,
      inject: [CASE_CATALOG, CASE_COMPLETION_REPOSITORY],
      useFactory: (
        catalog: CaseCatalog,
        completions: CaseCompletionRepository,
      ) => new GetCaseProgress(catalog, completions),
    },
    {
      provide: RecordCaseCompletion,
      inject: [CASE_COMPLETION_REPOSITORY, CLOCK],
      useFactory: (completions: CaseCompletionRepository, clock: Clock) =>
        new RecordCaseCompletion(completions, clock),
    },
  ],
  // Exported for other modules (via the public API) that record completions.
  exports: [RecordCaseCompletion],
})
export class CaseLibraryModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware()).forRoutes(CaseProgressController);
  }
}
