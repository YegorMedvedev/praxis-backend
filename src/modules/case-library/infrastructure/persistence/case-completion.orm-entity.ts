import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row per (user, case). `user_id` is a Firebase uid and `case_id` an
 * opaque case id: neither is a foreign key, so a completion outlives a case
 * that is hidden or removed, and the module stays extractable.
 */
@Entity({ schema: 'case_library', name: 'case_completions' })
export class CaseCompletionOrmEntity {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 128 })
  userId!: string;

  @PrimaryColumn({ name: 'case_id', type: 'varchar', length: 128 })
  caseId!: string;

  @Column({ name: 'completed_at', type: 'timestamptz' })
  completedAt!: Date;
}
