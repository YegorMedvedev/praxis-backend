import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { Clock } from '../../shared/clock';
import type { AppConfig } from '../config/app-config';
import { RateLimiter } from '../http/rate-limiter';
import { CLOCK } from '../system/system.tokens';
import { AuthGuard } from './auth.guard';
import { RATE_LIMITER, TOKEN_VERIFIER } from './auth.tokens';
import { createFirebaseTokenVerifier } from './firebase-token-verifier';

@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        createFirebaseTokenVerifier({
          FIREBASE_PROJECT_ID: config.get('FIREBASE_PROJECT_ID', {
            infer: true,
          }),
          FIREBASE_CREDENTIALS_JSON: config.get('FIREBASE_CREDENTIALS_JSON', {
            infer: true,
          }),
        }),
    },
    {
      // In-memory and per instance; see RateLimiter.
      provide: RATE_LIMITER,
      inject: [CLOCK],
      useFactory: (clock: Clock) => new RateLimiter(clock),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
