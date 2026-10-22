import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ProblemDetailsFilter } from './problem-details.filter';
import { RouteMethods } from './route-methods';

@Module({
  providers: [
    RouteMethods,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class HttpPlatformModule {}
