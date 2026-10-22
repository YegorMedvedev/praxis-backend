import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'users', name: 'profiles' })
export class ProfileOrmEntity {
  /** Firebase uid; points at the auth provider by id only. */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'terms_version', type: 'varchar', length: 128 })
  termsVersion!: string;

  @Column({ name: 'privacy_version', type: 'varchar', length: 128 })
  privacyVersion!: string;

  @Column({ name: 'consent_accepted_at', type: 'timestamptz' })
  consentAcceptedAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
