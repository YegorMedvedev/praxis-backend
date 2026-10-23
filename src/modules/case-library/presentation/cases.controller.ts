import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentIdentity } from '../../../platform/auth/current-identity.decorator';
import type { AuthenticatedIdentity } from '../../../platform/auth/identity';
import { GetCase } from '../application/get-case';
import { ListCases } from '../application/list-cases';
import { parseAcceptLanguage } from '../domain/language';
import { CaseDetailResponse, CaseListResponse } from './dto/case.response';
import { ProblemResponse } from './dto/problem.response';

const problem = { type: ProblemResponse };

const acceptLanguage = ApiHeader({
  name: 'Accept-Language',
  required: false,
  description:
    '`ru` selects Russian; `en`, absent or anything else selects English. The response carries `Content-Language`.',
});

@ApiTags('case-library')
@Controller('cases')
export class CasesController {
  constructor(
    private readonly listCases: ListCases,
    private readonly getCase: GetCase,
  ) {}

  @Get()
  @acceptLanguage
  @ApiOperation({
    summary: 'List the practice cases',
    description:
      'The whole visible catalog in curated order, with the caller completion state. No pagination; unknown query parameters are ignored.',
  })
  @ApiOkResponse({ type: CaseListResponse })
  @ApiUnauthorizedResponse({
    ...problem,
    description: '`unauthenticated` or `token-expired`.',
  })
  @ApiForbiddenResponse({ ...problem, description: '`account-disabled`.' })
  @ApiResponse({ status: 429, ...problem, description: '`rate-limited`.' })
  async list(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Headers('accept-language') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CaseListResponse> {
    const language = parseAcceptLanguage(header);
    response.setHeader('Content-Language', language);
    return CaseListResponse.from(
      await this.listCases.execute(identity, language),
    );
  }

  @Get(':case_id')
  @acceptLanguage
  @ApiOperation({
    summary: 'Get one practice case',
    description:
      'Everything the detail screen shows before a session. Never contains the twist, hidden background or persona. Unknown, hidden or malformed ids are all `case-not-found`.',
  })
  @ApiParam({ name: 'case_id', description: 'Opaque case id.' })
  @ApiOkResponse({ type: CaseDetailResponse })
  @ApiUnauthorizedResponse({
    ...problem,
    description: '`unauthenticated` or `token-expired`.',
  })
  @ApiForbiddenResponse({ ...problem, description: '`account-disabled`.' })
  @ApiNotFoundResponse({ ...problem, description: '`case-not-found`.' })
  @ApiResponse({ status: 429, ...problem, description: '`rate-limited`.' })
  async read(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Param('case_id') caseId: string,
    @Headers('accept-language') header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CaseDetailResponse> {
    const language = parseAcceptLanguage(header);
    response.setHeader('Content-Language', language);
    return CaseDetailResponse.from(
      await this.getCase.execute(identity, caseId, language),
    );
  }
}
