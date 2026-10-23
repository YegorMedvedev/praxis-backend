import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CASE_CATALOG,
  CASE_COMPLETION_REPOSITORY,
} from '../case-library.tokens';
import { CaseCompletionOrmEntity } from './persistence/case-completion.orm-entity';
import {
  CaseOrmEntity,
  CaseTranslationOrmEntity,
} from './persistence/case.orm-entity';
import { TypeOrmCaseCatalog } from './persistence/typeorm-case-catalog';
import { TypeOrmCaseCompletionRepository } from './persistence/typeorm-case-completion.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CaseOrmEntity,
      CaseTranslationOrmEntity,
      CaseCompletionOrmEntity,
    ]),
  ],
  providers: [
    { provide: CASE_CATALOG, useClass: TypeOrmCaseCatalog },
    {
      provide: CASE_COMPLETION_REPOSITORY,
      useClass: TypeOrmCaseCompletionRepository,
    },
  ],
  exports: [CASE_CATALOG, CASE_COMPLETION_REPOSITORY],
})
export class CaseLibraryInfrastructureModule {}
