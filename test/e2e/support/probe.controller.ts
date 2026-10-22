import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentIdentity } from '../../../src/platform/auth/current-identity.decorator';
import type { AuthenticatedIdentity } from '../../../src/platform/auth/identity';

/** Test-only authenticated endpoint standing in for `/me` (part B). */
@Controller('probe')
export class ProbeController {
  @Get()
  read(@CurrentIdentity() identity: AuthenticatedIdentity) {
    return { uid: identity.uid, email: identity.email };
  }

  @Put()
  replace(@Body() body: unknown) {
    return { received: body !== undefined };
  }
}
