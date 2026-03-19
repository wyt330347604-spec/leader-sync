import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TaskModule } from './modules/task/task.module';
import { DatabaseModule } from './database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    TaskModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
