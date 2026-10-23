import { ApiProperty } from '@nestjs/swagger';
import type { SessionView } from '../../application/session-view';

export class SessionStatsResponse {
  @ApiProperty({ type: 'integer', minimum: 0 })
  therapist_message_count!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  patient_message_count!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    nullable: true,
    description:
      'Whole seconds between creation and end, rounded down; null while IN_PROGRESS.',
  })
  duration_seconds!: number | null;

  @ApiProperty({ enum: ['THERAPIST', 'PATIENT'], nullable: true })
  ended_by!: 'THERAPIST' | 'PATIENT' | null;
}

/** The session as the API shows it. Never carries server-side attributes. */
export class SessionResponse {
  @ApiProperty({ description: 'Opaque id.' }) id!: string;
  @ApiProperty() case_id!: string;
  @ApiProperty({ enum: ['en', 'ru'] }) language!: string;
  @ApiProperty({
    enum: ['IN_PROGRESS', 'ENDED_BY_THERAPIST', 'ENDED_BY_PATIENT'],
    description:
      '`ENDED_BY_PATIENT` is reserved: nothing in this milestone produces it.',
  })
  status!: string;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ format: 'date-time', nullable: true }) ended_at!:
    string | null;
  @ApiProperty({ type: SessionStatsResponse }) stats!: SessionStatsResponse;

  static from(view: SessionView): SessionResponse {
    return {
      id: view.id,
      case_id: view.caseId,
      language: view.language,
      status: view.status,
      created_at: view.createdAt.toISOString(),
      ended_at: view.endedAt ? view.endedAt.toISOString() : null,
      stats: {
        therapist_message_count: view.stats.therapistMessageCount,
        patient_message_count: view.stats.patientMessageCount,
        duration_seconds: view.stats.durationSeconds,
        ended_by: view.stats.endedBy,
      },
    };
  }
}
