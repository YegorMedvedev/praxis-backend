import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../../platform/auth/public.decorator';
import { RequestPasswordReset } from '../application/request-password-reset';
import { DEFAULT_RESET_LANGUAGE } from '../domain/reset-language';
import { PasswordResetRequest } from './dto/password-reset.request';
import { ProblemResponse } from './dto/problem.response';
import { PasswordResetRateLimitGuard } from './password-reset-rate-limit.guard';

const problem = { type: ProblemResponse };

// The path is an action-shaped exception fixed by the frontend contract
// (AGENTS.md, "Known gaps").
@ApiTags('auth')
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly requestPasswordReset: RequestPasswordReset) {}

  @Post()
  @Public()
  @UseGuards(PasswordResetRateLimitGuard)
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request a password-reset email',
    description:
      'Unauthenticated. Answers `202 Accepted` with an empty body for every well-formed request before any work is done: link generation and email sending happen afterwards in the background, so neither the response nor its timing reveals whether an account exists. Failures and per-address throttling (3 per hour) are silent. Limited per client IP (default 5 per minute, then `429`). The request shape is an assumption: no spec defines it.',
    security: [],
  })
  @ApiAcceptedResponse({
    description:
      'Accepted. Identical for known and unknown addresses; carries `Cache-Control: no-store`.',
  })
  @ApiBadRequestResponse({
    ...problem,
    description:
      '`invalid-request` with `invalid_params` (also 413, 415 for the body).',
  })
  @ApiResponse({
    status: 429,
    ...problem,
    description: '`rate-limited`, with `Retry-After`.',
  })
  async request(@Body() body: PasswordResetRequest): Promise<void> {
    await this.requestPasswordReset.execute({
      email: body.email,
      language: body.language ?? DEFAULT_RESET_LANGUAGE,
    });
  }
}
