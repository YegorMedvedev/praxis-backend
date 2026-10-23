import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString } from 'class-validator';

// Only presence and JSON type are checked here. Trimming and the 1..2000
// character bound are domain rules (`normalizeTherapistText`), so they hold
// for every caller. Unknown properties (such as `role`) are ignored.
export class PostMessageRequest {
  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    description:
      'The therapist message. Trimmed by the server; 1..2000 characters after trimming (`TOO_SHORT` / `TOO_LONG` otherwise).',
  })
  @IsDefined()
  @IsString()
  text!: string;
}
