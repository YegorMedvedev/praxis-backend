import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  Optional,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  DomainError,
  InvalidRequestError,
  RateLimitedError,
} from '../../shared/domain-error';
import { FLOW_ID_HEADER, flowIdOf } from './flow-id';
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEMS,
  problemType,
  type ProblemDetails,
  type ProblemName,
} from './problem-details';
import { RequestValidationException } from './request-validation.exception';
import { RouteMethods } from './route-methods';

const STATUS_TO_PROBLEM: Record<number, ProblemName> = {
  400: 'invalid-request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not-found',
  405: 'invalid-request',
  409: 'conflict',
  413: 'invalid-request',
  415: 'invalid-request',
  422: 'validation-failed',
  503: 'service-unavailable',
};

/** Constant details for framework-level invalid requests; never echo input. */
const INVALID_REQUEST_DETAIL: Record<number, string> = {
  400: 'The request is malformed.',
  405: 'The method is not allowed for this resource.',
  413: 'The request body exceeds the maximum size of 8192 bytes.',
  415: 'The request Content-Type is not supported; use application/json.',
};

const UNMAPPED_4XX_DETAIL = 'The request could not be processed.';

interface ResolvedProblem {
  problem: Omit<ProblemDetails, 'flow_id'>;
  headers: Record<string, string>;
}

/** Status of an HttpException, or of an http-errors style error (body-parser). */
function httpStatusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (exception instanceof Error) {
    const status = (exception as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return status;
    }
  }
  return undefined;
}

/**
 * The single catch-all filter: every error leaving the API is an RFC 9457
 * problem. Only stable, constant members are emitted for framework errors, so
 * stack traces, SQL and internal detail never reach the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(@Optional() private readonly routes?: RouteMethods) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const flowId = flowIdOf(response) ?? randomUUID();
    const { problem, headers } = this.resolve(exception, request);

    response.setHeader(FLOW_ID_HEADER, flowId);
    for (const [name, value] of Object.entries(headers)) {
      response.setHeader(name, value);
    }
    response
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .send({ ...problem, flow_id: flowId });
  }

  private resolve(exception: unknown, request: Request): ResolvedProblem {
    const instance = request.originalUrl.split('?')[0];

    if (exception instanceof DomainError) {
      const headers: Record<string, string> = {};
      let extra: Partial<ProblemDetails> = {};
      if (exception instanceof RateLimitedError) {
        headers['Retry-After'] = String(exception.retryAfterSeconds);
      }
      if (exception instanceof InvalidRequestError) {
        extra = {
          invalid_params: exception.params.map(({ name, reason }) => ({
            name,
            reason,
          })),
        };
      }
      return this.finish(
        this.build(exception.code, instance, exception.message, extra),
        headers,
      );
    }

    if (exception instanceof RequestValidationException) {
      return this.finish({
        ...this.build('validation-failed', instance),
        errors: exception.errors,
      });
    }

    const status = httpStatusOf(exception);
    if (status !== undefined) {
      return this.fromHttpStatus(status, instance, request);
    }

    // Log the error type only: messages may embed user or transcript content.
    this.logger.error(
      `Unhandled exception (${exception instanceof Error ? exception.name : typeof exception})`,
    );
    return this.finish(this.build('internal-error', instance));
  }

  private fromHttpStatus(
    status: number,
    instance: string,
    request: Request,
  ): ResolvedProblem {
    let effective = status;
    const headers: Record<string, string> = {};

    // An unknown route is a 405 when the path exists under other methods.
    if (status === 404) {
      const allowed = this.routes?.allowedFor(instance) ?? [];
      // HEAD is served wherever GET is, so it is never a 405 for that reason.
      const served =
        allowed.includes(request.method) ||
        (request.method === 'HEAD' && allowed.includes('GET'));
      if (allowed.length > 0 && !served) {
        effective = 405;
        headers.Allow = allowed.join(', ');
      }
    }

    const name = STATUS_TO_PROBLEM[effective];
    if (!name) {
      // Any other 4xx stays a client error with its real status.
      if (effective >= 400 && effective < 500) {
        return this.finish(
          {
            ...this.build('invalid-request', instance, UNMAPPED_4XX_DETAIL),
            status: effective,
          },
          headers,
        );
      }
      this.logger.error(`Unmapped HTTP status (${effective})`);
      return this.finish(this.build('internal-error', instance));
    }
    const problem = this.build(
      name,
      instance,
      INVALID_REQUEST_DETAIL[effective],
    );
    // 405/413/415 are `invalid-request` with their real status.
    return this.finish(
      name === 'invalid-request' ? { ...problem, status: effective } : problem,
      headers,
    );
  }

  private finish(
    problem: Omit<ProblemDetails, 'flow_id'>,
    headers: Record<string, string> = {},
  ): ResolvedProblem {
    const out = { ...headers };
    if (problem.status === 401) {
      out['WWW-Authenticate'] = 'Bearer';
    }
    return { problem, headers: out };
  }

  private build(
    name: ProblemName,
    instance: string,
    detail?: string,
    extra: Partial<ProblemDetails> = {},
  ): Omit<ProblemDetails, 'flow_id'> {
    const { status, title, detail: fixedDetail } = PROBLEMS[name];
    const finalDetail = fixedDetail ?? detail;
    return {
      type: problemType(name),
      title,
      status,
      ...(finalDetail ? { detail: finalDetail } : {}),
      instance,
      ...extra,
    };
  }
}
