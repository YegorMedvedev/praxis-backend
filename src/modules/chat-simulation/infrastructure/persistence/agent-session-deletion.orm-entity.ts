import { Column, Entity, PrimaryColumn } from 'typeorm';

/** One remote (OpenAI) session waiting to be deleted. */
@Entity({ schema: 'chat_simulation', name: 'agent_session_deletions' })
export class AgentSessionDeletionOrmEntity {
  @PrimaryColumn({ name: 'openai_session_id', type: 'varchar', length: 256 })
  openaiSessionId!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
