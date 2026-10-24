import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';

/** Liveness probe for the hosting platform. Reports nothing about dependencies. */
@ApiTags('system')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Unauthenticated. Answers `200` while the process is serving requests. It does not check the database or any other dependency and exposes no detail.',
    security: [],
  })
  @ApiOkResponse({
    description: 'The process is alive.',
    schema: {
      type: 'object',
      properties: { status: { type: 'string', example: 'ok' } },
    },
  })
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
