import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '../../../platform/config/app-config';
import { CONSENT_VERSION_POLICY, PROFILE_REPOSITORY } from '../users.tokens';
import { ProfileOrmEntity } from './persistence/profile.orm-entity';
import { TypeOrmProfileRepository } from './persistence/typeorm-profile.repository';
import { StaticConsentVersionPolicy } from './static-consent-version-policy';

@Module({
  imports: [TypeOrmModule.forFeature([ProfileOrmEntity])],
  providers: [
    { provide: PROFILE_REPOSITORY, useClass: TypeOrmProfileRepository },
    {
      provide: CONSENT_VERSION_POLICY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new StaticConsentVersionPolicy(
          config.get('CONSENT_TERMS_VERSIONS', { infer: true }),
          config.get('CONSENT_PRIVACY_VERSIONS', { infer: true }),
        ),
    },
  ],
  exports: [PROFILE_REPOSITORY, CONSENT_VERSION_POLICY],
})
export class UsersInfrastructureModule {}
