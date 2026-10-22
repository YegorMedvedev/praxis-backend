import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../platform/config/app-config';
import { RateLimiter } from '../../platform/http/rate-limiter';
import { CLOCK } from '../../platform/system/system.tokens';
import type { Clock } from '../../shared/clock';
import { RequestPasswordReset } from './application/request-password-reset';
import type { BackgroundRunner } from './domain/background-runner';
import type { PasswordResetThrottle } from './domain/password-reset-throttle';
import type { PasswordResetFailureReporter } from './domain/password-reset-failure-reporter';
import type { PasswordResetLinkGenerator } from './domain/password-reset-link-generator';
import type { PasswordResetMailer } from './domain/password-reset-mailer';
import {
  PASSWORD_RESET_BACKGROUND_RUNNER,
  PASSWORD_RESET_FAILURE_REPORTER,
  PASSWORD_RESET_LINK_GENERATOR,
  PASSWORD_RESET_MAILER,
  PASSWORD_RESET_RATE_LIMITER,
  PASSWORD_RESET_THROTTLE,
} from './auth.tokens';
import { AuthInfrastructureModule } from './infrastructure/auth-infrastructure.module';
import { PasswordResetRateLimitGuard } from './presentation/password-reset-rate-limit.guard';
import { PasswordResetController } from './presentation/password-reset.controller';
import { noStoreMiddleware } from './presentation/no-store.middleware';

@Module({
  imports: [AuthInfrastructureModule],
  controllers: [PasswordResetController],
  providers: [
    {
      provide: RequestPasswordReset,
      inject: [
        PASSWORD_RESET_LINK_GENERATOR,
        PASSWORD_RESET_MAILER,
        ConfigService,
        PASSWORD_RESET_FAILURE_REPORTER,
        PASSWORD_RESET_BACKGROUND_RUNNER,
        PASSWORD_RESET_THROTTLE,
      ],
      useFactory: (
        links: PasswordResetLinkGenerator,
        mailer: PasswordResetMailer,
        config: ConfigService<AppConfig, true>,
        failures: PasswordResetFailureReporter,
        background: BackgroundRunner,
        throttle: PasswordResetThrottle,
      ) =>
        new RequestPasswordReset(
          links,
          mailer,
          config.get('APP_BASE_URL', { infer: true }),
          failures,
          background,
          throttle,
        ),
    },
    {
      // In-memory and per instance, like the global limiter.
      provide: PASSWORD_RESET_RATE_LIMITER,
      inject: [CLOCK, ConfigService],
      useFactory: (clock: Clock, config: ConfigService<AppConfig, true>) =>
        new RateLimiter(clock, {
          limit: config.get('PASSWORD_RESET_RATE_LIMIT', { infer: true }),
          windowMs: config.get('PASSWORD_RESET_RATE_WINDOW_MS', {
            infer: true,
          }),
          maxKeys: 10_000,
        }),
    },
    PasswordResetRateLimitGuard,
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware()).forRoutes(PasswordResetController);
  }
}
