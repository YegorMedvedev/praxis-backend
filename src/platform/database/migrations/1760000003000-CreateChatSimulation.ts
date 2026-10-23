import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `chat_simulation` schema. `user_id` and `case_id` are plain ids
 * with no foreign keys to other modules' schemas. Columns that later tasks
 * fill (`openai_session_id`, `remote_in_sync` for the OpenAI adapter) exist
 * from the start so they need no rework; `messages` is owned by the message
 * exchange task but created here so session stats are real and a discard
 * removes the transcript in the same statement (ON DELETE CASCADE).
 */
export class CreateChatSimulation1760000003000 implements MigrationInterface {
  name = 'CreateChatSimulation1760000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "chat_simulation"');
    await queryRunner.query(`
      CREATE TABLE "chat_simulation"."sessions" (
        "id" character varying(128) NOT NULL,
        "user_id" character varying(128) NOT NULL,
        "case_id" character varying(128) NOT NULL,
        "language" character varying(2) NOT NULL,
        "status" character varying(32) NOT NULL,
        "agent_id" character varying(256) NOT NULL,
        "openai_session_id" character varying(256),
        "remote_in_sync" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL,
        "ended_at" timestamptz,
        CONSTRAINT "PK_chat_simulation_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_chat_simulation_sessions_language"
          CHECK ("language" IN ('en', 'ru')),
        CONSTRAINT "CHK_chat_simulation_sessions_status"
          CHECK ("status" IN ('IN_PROGRESS', 'ENDED_BY_THERAPIST', 'ENDED_BY_PATIENT')),
        CONSTRAINT "CHK_chat_simulation_sessions_ended_at"
          CHECK (("status" = 'IN_PROGRESS') = ("ended_at" IS NULL))
      )
    `);
    // One session per user and case: creating a session discards the others.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chat_simulation_sessions_user_case"
        ON "chat_simulation"."sessions" ("user_id", "case_id")
    `);
    // Retention (task 05) scans by age.
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_simulation_sessions_created_at"
        ON "chat_simulation"."sessions" ("created_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "chat_simulation"."messages" (
        "id" character varying(128) NOT NULL,
        "session_id" character varying(128) NOT NULL,
        "seq" bigint GENERATED ALWAYS AS IDENTITY,
        "role" character varying(16) NOT NULL,
        "text" text NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "PK_chat_simulation_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_simulation_messages_session"
          FOREIGN KEY ("session_id") REFERENCES "chat_simulation"."sessions" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_chat_simulation_messages_role"
          CHECK ("role" IN ('THERAPIST', 'PATIENT'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_simulation_messages_session_seq"
        ON "chat_simulation"."messages" ("session_id", "seq")
    `);
    // Durable cleanup queue of remote sessions to delete (FR-10). The remote
    // id is the key, so queueing it twice keeps one entry.
    await queryRunner.query(`
      CREATE TABLE "chat_simulation"."agent_session_deletions" (
        "openai_session_id" character varying(256) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "PK_chat_simulation_agent_session_deletions"
          PRIMARY KEY ("openai_session_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_simulation_agent_session_deletions_due"
        ON "chat_simulation"."agent_session_deletions" ("next_attempt_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE "chat_simulation"."agent_session_deletions"',
    );
    await queryRunner.query('DROP TABLE "chat_simulation"."messages"');
    await queryRunner.query('DROP TABLE "chat_simulation"."sessions"');
    await queryRunner.query('DROP SCHEMA "chat_simulation"');
  }
}
