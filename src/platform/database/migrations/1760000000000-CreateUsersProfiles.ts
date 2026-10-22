import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the `users` schema and its `profiles` table. No cross-schema keys. */
export class CreateUsersProfiles1760000000000 implements MigrationInterface {
  name = 'CreateUsersProfiles1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "users"');
    await queryRunner.query(`
      CREATE TABLE "users"."profiles" (
        "id" character varying(128) NOT NULL,
        "name" character varying(100) NOT NULL,
        "terms_version" character varying(128) NOT NULL,
        "privacy_version" character varying(128) NOT NULL,
        "consent_accepted_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        CONSTRAINT "PK_users_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_users_profiles_name_length"
          CHECK (char_length(trim("name")) BETWEEN 2 AND 100)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "users"."profiles"');
    await queryRunner.query('DROP SCHEMA "users"');
  }
}
