import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { loadConfig } from './config/configuration.js';
import {
  AppExceptionFilter,
  LoggingInterceptor,
  RolesGuard,
  RequestIdInterceptor,
} from './common/common.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule, PrincipalMiddleware } from './modules/auth/auth.module.js';
import { VehiclesModule } from './modules/vehicles/vehicles.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { MetaController } from './modules/health/meta.controller.js';
import { CatalogStatsController } from './modules/health/catalog-stats.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      // One .env at the repo root serves the whole monorepo. Resolved from
      // this file rather than cwd, so the API loads the same config whether it
      // is started by turbo, by pnpm --filter, or by 'node dist/main.js'.
      envFilePath: [resolve(__dirname, '../../../.env'), resolve(process.cwd(), '.env')],
    }),
    // Baseline limit only. Per-route limits (auth, OTP, VIN decode) are
    // applied at the controller level — see docs/04 §10.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    AuthModule,
    VehiclesModule,
  ],
  controllers: [HealthController, MetaController, CatalogStatsController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Runs after the middleware has resolved a principal. Routes are private by
    // default; @Public() opts a route out (docs/07 §5).
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PrincipalMiddleware).forRoutes('*');
  }
}
