import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentIdentity } from '../../../platform/auth/current-identity.decorator';
import type { AuthenticatedIdentity } from '../../../platform/auth/identity';
import { CreateSession } from '../application/create-session';
import { DiscardSession } from '../application/discard-session';
import { EndSession } from '../application/end-session';
import { GetSession } from '../application/get-session';
import { ProblemResponse } from './dto/problem.response';
import { CreateSessionRequest, EndSessionRequest } from './dto/session.request';
import { SessionResponse } from './dto/session.response';

const problem = { type: ProblemResponse };

const unauthorized = ApiUnauthorizedResponse({
  ...problem,
  description: '`unauthenticated` or `token-expired`.',
});
const rateLimited = ApiResponse({
  status: 429,
  ...problem,
  description: '`rate-limited`.',
});
const sessionId = ApiParam({
  name: 'session_id',
  description:
    'Opaque session id. A session of another user is reported as not found.',
});

@ApiTags('chat-simulation')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly createSession: CreateSession,
    private readonly getSession: GetSession,
    private readonly endSession: EndSession,
    private readonly discardSession: DiscardSession,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Start a practice session for a case',
    description:
      'Discards every other session of the caller for the same case, in any status. Case completion is unaffected. The patient opening message is fetched through the reply stream.',
  })
  @ApiCreatedResponse({
    type: SessionResponse,
    headers: {
      Location: {
        description: 'URL of the new session.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({ ...problem, description: '`invalid-request`.' })
  @unauthorized
  @ApiForbiddenResponse({ ...problem, description: '`account-disabled`.' })
  @ApiNotFoundResponse({
    ...problem,
    description:
      '`case-not-found`: unknown, hidden, or no patient agent for the language.',
  })
  @rateLimited
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body() body: CreateSessionRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const view = await this.createSession.execute({
      userId: identity.uid,
      caseId: body.case_id,
      language: body.language,
    });
    const collection = request.originalUrl.split('?')[0].replace(/\/+$/, '');
    response.setHeader(
      'Location',
      `${collection}/${encodeURIComponent(view.id)}`,
    );
    return SessionResponse.from(view);
  }

  @Get(':session_id')
  @sessionId
  @ApiOperation({
    summary: 'Get a session',
    description:
      'The single source of summary data. Counts include stored messages only; an ended session returns an identical body on every call.',
  })
  @ApiOkResponse({ type: SessionResponse })
  @unauthorized
  @ApiNotFoundResponse({ ...problem, description: '`session-not-found`.' })
  @rateLimited
  async read(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('session_id') id: string,
  ): Promise<SessionResponse> {
    return SessionResponse.from(
      await this.getSession.execute(identity.uid, id),
    );
  }

  @Patch(':session_id')
  @sessionId
  @ApiOperation({
    summary: 'End a session as the therapist',
    description:
      'Idempotent. Marks the case completed for the caller in the same commit. A reply being generated is cancelled and not stored.',
  })
  @ApiOkResponse({ type: SessionResponse })
  @ApiBadRequestResponse({ ...problem, description: '`invalid-request`.' })
  @unauthorized
  @ApiNotFoundResponse({ ...problem, description: '`session-not-found`.' })
  @ApiConflictResponse({
    ...problem,
    description: '`session-ended`: the session was ended by the patient.',
  })
  @rateLimited
  async end(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('session_id') id: string,
    @Body() _body: EndSessionRequest,
  ): Promise<SessionResponse> {
    return SessionResponse.from(
      await this.endSession.execute(identity.uid, id),
    );
  }

  @Delete(':session_id')
  @HttpCode(204)
  @sessionId
  @ApiOperation({
    summary: 'Discard a session and its transcript',
    description:
      'Idempotent: 204 also when the session no longer exists or belongs to another user. Does not undo case completion. The remote session is deleted asynchronously.',
  })
  @ApiNoContentResponse({ description: 'Discarded or already gone.' })
  @unauthorized
  @rateLimited
  async discard(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('session_id') id: string,
  ): Promise<void> {
    await this.discardSession.execute(identity.uid, id);
  }
}
