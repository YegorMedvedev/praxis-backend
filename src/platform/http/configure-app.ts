import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from '../config/app-config';
import { flowIdMiddleware } from './flow-id';
import { jsonContentTypeMiddleware, MAX_BODY_BYTES } from './json-content-type';
import { requestLoggingMiddleware } from './request-logging';
import { InvalidRequestError } from '../../shared/domain-error';
import { toInvalidParams } from './validation-params';

export const API_PREFIX = 'api/v1';

/**
 * Trusts exactly `hops` reverse proxies for `req.ip` (X-Forwarded-For). An
 * explicit count, never `true`: with `true` a client could spoof its address
 * and dodge the per-IP rate limit.
 */
export function applyTrustProxy(app: INestApplication, hops: number): void {
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error('trust proxy hops must be a non-negative integer');
  }
  app.getHttpAdapter().getInstance().set('trust proxy', hops);
}

/** Shared by `main.ts` and the e2e tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication): void {
  // Order matters: the flow id first (logging and the problem filter read
  // it), then logging so even rejected requests are recorded.
  app.use(flowIdMiddleware());
  app.use(requestLoggingMiddleware(new Logger('HttpRequest')));
  app.use(jsonContentTypeMiddleware());
  (app as NestExpressApplication).useBodyParser('json', {
    limit: MAX_BODY_BYTES,
  });

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  applyTrustProxy(app, config.get('TRUST_PROXY_HOPS', { infer: true }));

  app.setGlobalPrefix(API_PREFIX);

  // Tolerant reader: unknown properties are ignored (no whitelist/forbid),
  // known ones are validated strictly.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      exceptionFactory: (errors) =>
        new InvalidRequestError(
          'Request validation failed',
          toInvalidParams(errors),
        ),
    }),
  );

  // The docs are not a public endpoint in production (no endpoint is public).
  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    return;
  }
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Praxis API')
      .setVersion('1')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearerAuth',
      )
      .addSecurityRequirements('bearerAuth')
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
