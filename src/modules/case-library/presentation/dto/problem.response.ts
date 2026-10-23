import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvalidParamResponse {
  @ApiProperty({ example: 'name' }) name!: string;
  @ApiProperty({
    enum: [
      'REQUIRED',
      'TOO_SHORT',
      'TOO_LONG',
      'INVALID_TYPE',
      'INVALID_VALUE',
      'UNKNOWN_VERSION',
      'OUT_OF_RANGE',
    ],
  })
  reason!: string;
}

/** RFC 9457 problem details, `application/problem+json`. */
export class ProblemResponse {
  @ApiProperty({ example: '/problems/invalid-request' }) type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: number;
  @ApiPropertyOptional() detail?: string;
  @ApiProperty() instance!: string;
  @ApiProperty() flow_id!: string;
  @ApiPropertyOptional({
    type: [InvalidParamResponse],
    description: 'Present on `invalid-request` for property validation.',
  })
  invalid_params?: InvalidParamResponse[];
}
