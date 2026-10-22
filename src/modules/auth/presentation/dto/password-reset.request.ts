import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  RESET_LANGUAGES,
  type ResetLanguage,
} from '../../domain/reset-language';

export class PasswordResetRequest {
  @ApiProperty({
    description: 'Address of the account to reset. At most 254 characters.',
    example: 'elena@example.com',
    maxLength: 254,
  })
  @IsDefined()
  @IsString()
  @MaxLength(254)
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    enum: RESET_LANGUAGES,
    default: 'en',
    description: 'Language of the email. Defaults to `en`.',
  })
  @IsOptional()
  @IsIn(RESET_LANGUAGES)
  language?: ResetLanguage;
}
