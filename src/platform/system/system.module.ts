import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import type { Clock } from '../../shared/clock';
import type { IdGenerator } from '../../shared/id-generator';
import { HealthController } from './health.controller';
import { CLOCK, ID_GENERATOR } from './system.tokens';

const systemClock: Clock = { now: () => new Date() };
const uuidGenerator: IdGenerator = { next: () => randomUUID() };

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: ID_GENERATOR, useValue: uuidGenerator },
  ],
  exports: [CLOCK, ID_GENERATOR],
})
export class SystemModule {}
