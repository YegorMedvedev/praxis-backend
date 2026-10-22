import { HttpException } from '@nestjs/common';
import type { FieldError } from './problem-details';

export class RequestValidationException extends HttpException {
  constructor(readonly errors: FieldError[]) {
    super('Request validation failed', 422);
  }
}
