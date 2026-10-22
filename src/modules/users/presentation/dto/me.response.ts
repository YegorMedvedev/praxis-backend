import { ApiProperty } from '@nestjs/swagger';
import type { Me } from '../../application/me';

export class ConsentResponse {
  @ApiProperty() terms_version!: string;
  @ApiProperty() privacy_version!: string;
  @ApiProperty({ format: 'date-time', description: 'RFC 3339, UTC.' })
  accepted_at!: string;
}

export class MeResponse {
  @ApiProperty({ description: 'Opaque id; equals the Firebase uid.' })
  id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'From the verified token, not from storage.' })
  email!: string;
  @ApiProperty({ type: ConsentResponse }) consent!: ConsentResponse;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
  @ApiProperty({ format: 'date-time' }) updated_at!: string;

  static from(me: Me): MeResponse {
    return {
      id: me.id,
      name: me.name,
      email: me.email,
      consent: {
        terms_version: me.consent.termsVersion,
        privacy_version: me.consent.privacyVersion,
        accepted_at: me.consent.acceptedAt.toISOString(),
      },
      created_at: me.createdAt.toISOString(),
      updated_at: me.updatedAt.toISOString(),
    };
  }
}
