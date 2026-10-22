import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Only presence and JSON type are checked here; length (after trimming) and
// version recognition are domain rules. Unknown properties are ignored.

export class ConsentRequest {
  @ApiProperty({ description: 'Accepted Terms of Service version.' })
  @IsDefined()
  @IsString()
  terms_version!: string;

  @ApiProperty({ description: 'Accepted Privacy Policy version.' })
  @IsDefined()
  @IsString()
  privacy_version!: string;
}

export class PutMeRequest {
  @ApiProperty({
    description: 'Display name. Trimmed; 2 to 100 characters after trimming.',
    example: 'Elena',
  })
  @IsDefined()
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    type: ConsentRequest,
    description:
      'Required when the profile is created. The server records the time of receipt; a changed version pair re-records acceptance.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => ConsentRequest)
  consent?: ConsentRequest;
}
