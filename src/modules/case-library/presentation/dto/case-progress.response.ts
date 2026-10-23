import { ApiProperty } from '@nestjs/swagger';
import type { CaseProgress } from '../../application/get-case-progress';

export class CaseProgressResponse {
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Visible cases the caller has completed.',
  })
  completed_count!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Cases currently visible in the catalog.',
  })
  total_count!: number;

  static from(progress: CaseProgress): CaseProgressResponse {
    return {
      completed_count: progress.completedCount,
      total_count: progress.totalCount,
    };
  }
}
