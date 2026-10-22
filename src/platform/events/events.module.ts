import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventEmitterDomainEventPublisher } from './event-emitter-domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER } from './events.tokens';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    {
      provide: DOMAIN_EVENT_PUBLISHER,
      useClass: EventEmitterDomainEventPublisher,
    },
  ],
  exports: [DOMAIN_EVENT_PUBLISHER],
})
export class EventsModule {}
