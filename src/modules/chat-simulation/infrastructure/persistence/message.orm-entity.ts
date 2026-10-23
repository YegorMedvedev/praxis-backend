import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * `session_id` has a foreign key inside this module's own schema (so a
 * discard removes the transcript), never across schemas. `seq` is the
 * database's identity column and fixes the order of messages stored within
 * the same instant; it is never written by the application.
 */
@Entity({ schema: 'chat_simulation', name: 'messages' })
export class MessageOrmEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Column({ name: 'session_id', type: 'varchar', length: 128 })
  sessionId!: string;

  @Column({
    type: 'bigint',
    insert: false,
    update: false,
    select: false,
  })
  seq?: string;

  @Column({ type: 'varchar', length: 16 })
  role!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
