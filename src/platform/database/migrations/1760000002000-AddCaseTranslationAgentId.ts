import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the server-only patient agent id to each case translation. Additive and
 * nullable: existing rows are untouched and keep a null id until the seed sets
 * one. Never exposed over HTTP.
 */
export class AddCaseTranslationAgentId1760000002000 implements MigrationInterface {
  name = 'AddCaseTranslationAgentId1760000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "case_library"."case_translations" ADD COLUMN "agent_id" character varying(128)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "case_library"."case_translations" DROP COLUMN "agent_id"',
    );
  }
}
