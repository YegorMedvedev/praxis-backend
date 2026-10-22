import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../shared/domain-error';
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEMS,
  problemType,
  type ProblemDetails,
  type ProblemName,
} from './problem-details';
import { RequestValidationException } from './request-validation.exception';

const STATUS_TO_PROBLEM: Record<number, ProblemName> = {
  400: 'validation-failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  422: 'validation-failed',
};

/**
 * The single catch-all filter: every error leaving the API is an RFC 9457
 * problem. Only stable, constant members are emitted for framework errors, so
 * stack traces, SQL and internal detail never reach the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception, request);
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDetails {
    const instance = request.originalUrl.split('?')[0];

    if (exception instanceof DomainError) {
      return this.build(exception.code, instance, exception.message);
    }

    if (exception instanceof RequestValidationException) {
      return {
        ...this.build('validation-failed', instance),
        errors: exception.errors,
      };
    }

    if (exception instanceof HttpException) {
      const name = STATUS_TO_PROBLEM[exception.getStatus()];
      if (name) {
        return this.build(name, instance);
      }
    }

    // Log the error type only: messages may embed user or transcript content.
    this.logger.error(
      `Unhandled exception (${exception instanceof Error ? exception.name : typeof exception})`,
    );
    return this.build('internal-error', instance);
  }

  private build(
    name: ProblemName,
    instance: string,
    detail?: string,
  ): ProblemDetails {
    const { status, title } = PROBLEMS[name];
    return {
      type: problemType(name),
      title,
      status,
      ...(detail ? { detail } : {}),
      instance,
    };
  }
}
