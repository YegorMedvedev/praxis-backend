import { Body, Controller, Get, Put, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentIdentity } from '../../../platform/auth/current-identity.decorator';
import type { AuthenticatedIdentity } from '../../../platform/auth/identity';
import { GetMe } from '../application/get-me';
import { PutMe } from '../application/put-me';
import { MeResponse } from './dto/me.response';
import { ProblemResponse } from './dto/problem.response';
import { PutMeRequest } from './dto/put-me.request';

const problem = { type: ProblemResponse };

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly getMe: GetMe,
    private readonly putMe: PutMe,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get the caller's profile" })
  @ApiOkResponse({ type: MeResponse })
  @ApiUnauthorizedResponse({
    ...problem,
    description: '`unauthenticated` or `token-expired`.',
  })
  @ApiForbiddenResponse({ ...problem, description: '`account-disabled`.' })
  @ApiNotFoundResponse({
    ...problem,
    description: '`profile-not-found`: valid token, no profile yet.',
  })
  @ApiResponse({ status: 429, ...problem, description: '`rate-limited`.' })
  async read(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ): Promise<MeResponse> {
    return MeResponse.from(await this.getMe.execute(identity));
  }

  @Put()
  @ApiOperation({
    summary: "Create or replace the caller's profile",
    description:
      'Idempotent. `id` and `email` come from the verified token; unknown and read-only properties are ignored.',
  })
  @ApiCreatedResponse({
    type: MeResponse,
    description: 'The profile was created.',
    headers: {
      Location: {
        description: 'URL of the profile.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: MeResponse, description: 'The profile was replaced.' })
  @ApiBadRequestResponse({
    ...problem,
    description:
      '`invalid-request` with `invalid_params` (also 405 with `Allow`, 413, 415).',
  })
  @ApiUnauthorizedResponse({
    ...problem,
    description: '`unauthenticated` or `token-expired`.',
  })
  @ApiForbiddenResponse({ ...problem, description: '`account-disabled`.' })
  @ApiResponse({ status: 429, ...problem, description: '`rate-limited`.' })
  @ApiHeader({
    name: 'Content-Type',
    required: true,
    example: 'application/json',
  })
  async replace(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: PutMeRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MeResponse> {
    const { me, created } = await this.putMe.execute({
      caller: identity,
      name: body.name,
      consent: body.consent,
    });
    if (created) {
      response.status(201).location(request.originalUrl.split('?')[0]);
    } else {
      response.status(200);
    }
    return MeResponse.from(me);
  }
}
