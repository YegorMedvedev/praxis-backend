import { ApiProperty } from '@nestjs/swagger';
import type { CaseView } from '../../application/case-view';
import {
  CASE_AVATARS,
  CASE_CATEGORIES,
  CASE_LEVELS,
  type CaseAvatar,
  type CaseCategory,
  type CaseLevel,
} from '../../domain/case';

/** A library card (spec case-library/01). Reused by the detail resource. */
export class CaseSummaryResponse {
  @ApiProperty({ description: 'Opaque, stable identifier.' })
  id!: string;

  @ApiProperty({ description: 'Localized by `Accept-Language`.' })
  title!: string;

  @ApiProperty({ description: 'Localized by `Accept-Language`.' })
  teaser!: string;

  @ApiProperty({ enum: CASE_LEVELS }) level!: CaseLevel;
  @ApiProperty({ enum: CASE_CATEGORIES }) category!: CaseCategory;
  @ApiProperty({ enum: CASE_AVATARS }) avatar!: CaseAvatar;

  @ApiProperty({ description: 'Whether the caller has completed the case.' })
  completed!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'RFC 3339 UTC time of the first completion, or null.',
  })
  completed_at!: string | null;

  static from(view: CaseView): CaseSummaryResponse {
    return {
      id: view.id,
      title: view.title,
      teaser: view.teaser,
      level: view.level,
      category: view.category,
      avatar: view.avatar,
      completed: view.completed,
      completed_at: view.completedAt?.toISOString() ?? null,
    };
  }
}

export class CaseListResponse {
  @ApiProperty({ type: [CaseSummaryResponse] })
  items!: CaseSummaryResponse[];

  static from(views: CaseView[]): CaseListResponse {
    return { items: views.map((v) => CaseSummaryResponse.from(v)) };
  }
}

export class CasePatientResponse {
  @ApiProperty({ description: 'Fictional name, localized.' }) name!: string;
  @ApiProperty({ type: 'integer' }) age!: number;
}

export class CaseDetailResponse extends CaseSummaryResponse {
  @ApiProperty({ description: 'Context only. Localized.' })
  scenario!: string;

  @ApiProperty({ type: CasePatientResponse })
  patient!: CasePatientResponse;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Complete sentence(s) to display, lead-in included, or null when the case needs no note. Localized.',
  })
  content_note!: string | null;

  static from(view: CaseView): CaseDetailResponse {
    return {
      ...CaseSummaryResponse.from(view),
      scenario: view.scenario,
      patient: { name: view.patientName, age: view.patientAge },
      content_note: view.contentNote,
    };
  }
}
