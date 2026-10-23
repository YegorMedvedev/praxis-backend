import { Controller, Get } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentIdentity } from '../../../platform/auth/current-identity.decorator';
import type { AuthenticatedIdentity } from '../../../platform/auth/identity';
import { GetCaseProgress } from '../application/get-case-progress';
import { CaseProgressResponse } from './dto/case-progress.response';
import { ProblemResponse } from './dto/problem.response';

const problem = { type: ProblemResponse };

@ApiTags('case-library')
@Controller('me/case-progress')
export class CaseProgressController {
  constructor(private readonly getCaseProgress: GetCaseProgress) {}

  @Get()
  @ApiOperation({
    summary: "Get the caller's progress over the case catalog",
    description:
      'Counts only currently visible cases and is independent of any library filter. There is no endpoint to set or clear completion.',
  })
  @ApiOkResponse({ type: CaseProgressResponse })
  @ApiUnauthorizedResponse({
    ...problem,
    description: '`unauthenticated` or `token-expired`.',
  })
  @ApiForbiddenResponse({ ...problem, description: '`account-disabled`.' })
  @ApiResponse({ status: 429, ...problem, description: '`rate-limited`.' })
  async read(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ): Promise<CaseProgressResponse> {
    return CaseProgressResponse.from(
      await this.getCaseProgress.execute(identity),
    );
  }
}
