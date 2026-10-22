import { Module } from '@nestjs/common';
import { AppConfigModule } from './platform/config/app-config.module';
import { AuthModule } from './platform/auth/auth.module';
import { DatabaseModule } from './platform/database/database.module';
import { EventsModule } from './platform/events/events.module';
import { HttpPlatformModule } from './platform/http/http.module';
import { SystemModule } from './platform/system/system.module';

@Module({
  imports: [
    AppConfigModule,
    SystemModule,
    EventsModule,
    DatabaseModule,
    HttpPlatformModule,
    AuthModule,
    // Business modules are registered here via their public API.
  ],
})
export class AppModule {}
