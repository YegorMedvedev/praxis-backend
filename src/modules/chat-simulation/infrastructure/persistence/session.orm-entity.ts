import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * `user_id` is a Firebase uid and `case_id` an opaque case id: plain columns,
 * never foreign keys, so the module stays extractable.
 */
@Entity({ schema: 'chat_simulation', name: 'sessions' })
export class SessionOrmEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 128 })
  userId!: string;

  @Column({ name: 'case_id', type: 'varchar', length: 128 })
  caseId!: string;

  @Column({ type: 'varchar', length: 2 })
  language!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: string;

  @Column({ name: 'agent_id', type: 'varchar', length: 256 })
  agentId!: string;

  @Column({
    name: 'openai_session_id',
    type: 'varchar',
    length: 256,
    nullable: true,
  })
  openaiSessionId!: string | null;

  @Column({ name: 'remote_in_sync', type: 'boolean', default: true })
  remoteInSync!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}
