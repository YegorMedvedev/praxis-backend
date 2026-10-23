import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';

// Both entities share this file: the two sides of the relation reference each
// other, and separate files would form an import cycle.

@Entity({ schema: 'case_library', name: 'cases' })
export class CaseOrmEntity {
  /** Opaque, stable id. */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  /** Curated catalog order, ascending. */
  @Column({ type: 'integer' })
  position!: number;

  @Column({ type: 'varchar', length: 16 })
  level!: string;

  @Column({ type: 'varchar', length: 32 })
  category!: string;

  @Column({ type: 'varchar', length: 16 })
  avatar!: string;

  @Column({ name: 'patient_age', type: 'integer' })
  patientAge!: number;

  @OneToMany(() => CaseTranslationOrmEntity, (translation) => translation.case)
  translations?: CaseTranslationOrmEntity[];
}

@Entity({ schema: 'case_library', name: 'case_translations' })
export class CaseTranslationOrmEntity {
  @PrimaryColumn({ name: 'case_id', type: 'varchar', length: 128 })
  caseId!: string;

  @PrimaryColumn({ type: 'varchar', length: 2 })
  language!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  teaser!: string;

  @Column({ type: 'text' })
  scenario!: string;

  @Column({ name: 'patient_name', type: 'text' })
  patientName!: string;

  @Column({ name: 'content_note', type: 'text', nullable: true })
  contentNote!: string | null;

  @ManyToOne(() => CaseOrmEntity, (c) => c.translations)
  @JoinColumn({ name: 'case_id' })
  case?: CaseOrmEntity;
}
