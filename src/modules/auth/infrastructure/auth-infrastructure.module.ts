import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getFirebaseAuth } from '../../../platform/auth/firebase-app';
import type { AppConfig } from '../../../platform/config/app-config';
import {
  PASSWORD_RESET_BACKGROUND_RUNNER,
  PASSWORD_RESET_FAILURE_REPORTER,
  PASSWORD_RESET_LINK_GENERATOR,
  PASSWORD_RESET_MAILER,
  PASSWORD_RESET_THROTTLE,
  RESEND_HTTP_CLIENT,
} from '../auth.tokens';
import { CLOCK } from '../../../platform/system/system.tokens';
import type { Clock } from '../../../shared/clock';
import type { PasswordResetFailureReporter } from '../domain/password-reset-failure-reporter';
import { HashedEmailThrottle } from './hashed-email-throttle';
import { InProcessBackgroundRunner } from './in-process-background-runner';
import { FirebasePasswordResetLinkGenerator } from './firebase-password-reset-link-generator';
import { LoggerPasswordResetFailureReporter } from './logger-password-reset-failure-reporter';
import {
  ResendPasswordResetMailer,
  type HttpClient,
} from './resend-password-reset-mailer';

@Module({
  providers: [
    {
      provide: PASSWORD_RESET_LINK_GENERATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        new FirebasePasswordResetLinkGenerator(
          getFirebaseAuth({
            FIREBASE_PROJECT_ID: config.get('FIREBASE_PROJECT_ID', {
              infer: true,
            }),
            FIREBASE_CREDENTIALS_JSON: config.get('FIREBASE_CREDENTIALS_JSON', {
              infer: true,
            }),
          }),
        ),
    },
    {
      provide: RESEND_HTTP_CLIENT,
      useValue: ((url, init) => fetch(url, init)) as HttpClient,
    },
    {
      provide: PASSWORD_RESET_MAILER,
      inject: [ConfigService, RESEND_HTTP_CLIENT],
      useFactory: (config: ConfigService<AppConfig, true>, http: HttpClient) =>
        new ResendPasswordResetMailer(
          http,
          config.get('RESEND_API_KEY', { infer: true }),
          config.get('PASSWORD_RESET_EMAIL_FROM', { infer: true }),
        ),
    },
    {
      provide: PASSWORD_RESET_FAILURE_REPORTER,
      useClass: LoggerPasswordResetFailureReporter,
    },
    {
      provide: PASSWORD_RESET_BACKGROUND_RUNNER,
      inject: [PASSWORD_RESET_FAILURE_REPORTER],
      useFactory: (failures: PasswordResetFailureReporter) =>
        new InProcessBackgroundRunner(failures),
    },
    {
      provide: PASSWORD_RESET_THROTTLE,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new HashedEmailThrottle(clock),
    },
  ],
  exports: [
    PASSWORD_RESET_BACKGROUND_RUNNER,
    PASSWORD_RESET_THROTTLE,
    PASSWORD_RESET_LINK_GENERATOR,
    PASSWORD_RESET_MAILER,
    PASSWORD_RESET_FAILURE_REPORTER,
  ],
})
export class AuthInfrastructureModule {}
