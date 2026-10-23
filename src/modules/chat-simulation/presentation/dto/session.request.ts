import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsIn, IsNotEmpty, IsString } from 'class-validator';

// Only presence, JSON type and the enum are checked here. Unknown properties
// are ignored. Whether the case exists is a domain rule.

export class CreateSessionRequest {
  @ApiProperty({ description: 'The case to practise.' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  case_id!: string;

  @ApiProperty({
    enum: ['en', 'ru'],
    description: 'Fixed for the lifetime of the session.',
  })
  @IsDefined()
  @IsIn(['en', 'ru'])
  language!: 'en' | 'ru';
}

export class EndSessionRequest {
  @ApiProperty({
    enum: ['ENDED_BY_THERAPIST'],
    description: 'The only accepted value; any other is `invalid-request`.',
  })
  @IsDefined()
  @IsIn(['ENDED_BY_THERAPIST'])
  status!: 'ENDED_BY_THERAPIST';
}
