import { Module } from '@nestjs/common';
import { AppConfigModule } from './platform/config/app-config.module';
import { AuthModule } from './platform/auth/auth.module';
import { DatabaseModule } from './platform/database/database.module';
import { EventsModule } from './platform/events/events.module';
import { HttpPlatformModule } from './platform/http/http.module';
import { AuthModule as AuthFeatureModule } from './modules/auth/auth.public-api';
import { UsersModule } from './modules/users/users.public-api';
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
    UsersModule,
    AuthFeatureModule,
  ],
})
export class AppModule {}
