import {
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { FieldError } from './problem-details';
import { RequestValidationException } from './request-validation.exception';

export const API_PREFIX = 'api/v1';

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.keys(error.constraints ?? {}).map((reason) => ({
      field,
      reason,
    }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/** Shared by `main.ts` and the e2e tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);

  // Tolerant reader: unknown properties are ignored (no whitelist/forbid),
  // known ones are validated strictly.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      exceptionFactory: (errors) =>
        new RequestValidationException(flatten(errors)),
    }),
  );

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Praxis API').setVersion('1').build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
