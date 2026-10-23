import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `case_library` schema: curated cases, their per-language text
 * and per-user completions. Completions carry no foreign keys (neither to
 * `users` nor to `cases`), so they survive a case being hidden or removed.
 */
export class CreateCaseLibrary1760000001000 implements MigrationInterface {
  name = 'CreateCaseLibrary1760000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "case_library"');
    await queryRunner.query(`
      CREATE TABLE "case_library"."cases" (
        "id" character varying(128) NOT NULL,
        "position" integer NOT NULL,
        "level" character varying(16) NOT NULL,
        "category" character varying(32) NOT NULL,
        "avatar" character varying(16) NOT NULL,
        "patient_age" integer NOT NULL,
        CONSTRAINT "PK_case_library_cases" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_case_library_cases_id" CHECK (char_length(trim("id")) > 0),
        CONSTRAINT "CHK_case_library_cases_level"
          CHECK ("level" IN ('EASY', 'MEDIUM', 'HARD', 'EXTREME')),
        CONSTRAINT "CHK_case_library_cases_category" CHECK ("category" IN (
          'SUICIDAL_IDEATION', 'HARM_TO_OTHERS', 'TRAUMA_DISCLOSURE',
          'SUBSTANCE_USE', 'BOUNDARY_TESTING')),
        CONSTRAINT "CHK_case_library_cases_avatar"
          CHECK ("avatar" IN ('LONG_HAIR', 'SHORT_HAIR', 'HAIR_UP', 'OLDER_GREY')),
        CONSTRAINT "CHK_case_library_cases_patient_age"
          CHECK ("patient_age" BETWEEN 0 AND 130)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "case_library"."case_translations" (
        "case_id" character varying(128) NOT NULL,
        "language" character varying(2) NOT NULL,
        "title" text NOT NULL,
        "teaser" text NOT NULL,
        "scenario" text NOT NULL,
        "patient_name" text NOT NULL,
        "content_note" text,
        CONSTRAINT "PK_case_library_case_translations" PRIMARY KEY ("case_id", "language"),
        CONSTRAINT "FK_case_library_case_translations_case"
          FOREIGN KEY ("case_id") REFERENCES "case_library"."cases" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_case_library_case_translations_language"
          CHECK ("language" IN ('en', 'ru')),
        CONSTRAINT "CHK_case_library_case_translations_text" CHECK (
          char_length(trim("title")) > 0 AND char_length(trim("teaser")) > 0
          AND char_length(trim("scenario")) > 0 AND char_length(trim("patient_name")) > 0
          AND ("content_note" IS NULL OR char_length(trim("content_note")) > 0))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "case_library"."case_completions" (
        "user_id" character varying(128) NOT NULL,
        "case_id" character varying(128) NOT NULL,
        "completed_at" timestamptz NOT NULL,
        CONSTRAINT "PK_case_library_case_completions" PRIMARY KEY ("user_id", "case_id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "case_library"."case_completions"');
    await queryRunner.query('DROP TABLE "case_library"."case_translations"');
    await queryRunner.query('DROP TABLE "case_library"."cases"');
    await queryRunner.query('DROP SCHEMA "case_library"');
  }
}
