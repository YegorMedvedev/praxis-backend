import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CLOCK } from '../../platform/system/system.tokens';
import type { Clock } from '../../shared/clock';
import { GetMe } from './application/get-me';
import { PutMe } from './application/put-me';
import type { ConsentVersionPolicy } from './domain/consent-version-policy';
import type { ProfileRepository } from './domain/profile.repository';
import { UsersInfrastructureModule } from './infrastructure/users-infrastructure.module';
import { MeController } from './presentation/me.controller';
import { noStoreMiddleware } from './presentation/no-store.middleware';
import { CONSENT_VERSION_POLICY, PROFILE_REPOSITORY } from './users.tokens';

@Module({
  imports: [UsersInfrastructureModule],
  controllers: [MeController],
  providers: [
    {
      provide: GetMe,
      inject: [PROFILE_REPOSITORY],
      useFactory: (profiles: ProfileRepository) => new GetMe(profiles),
    },
    {
      provide: PutMe,
      inject: [PROFILE_REPOSITORY, CONSENT_VERSION_POLICY, CLOCK],
      useFactory: (
        profiles: ProfileRepository,
        policy: ConsentVersionPolicy,
        clock: Clock,
      ) => new PutMe(profiles, policy, clock),
    },
  ],
})
export class UsersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware()).forRoutes(MeController);
  }
}
