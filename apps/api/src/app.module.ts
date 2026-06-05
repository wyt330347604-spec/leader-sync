import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { TaskModule } from './modules/task/task.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProjectModule } from './modules/project/project.module';
import { UserModule } from './modules/user/user.module';
import { NotificationPreferenceModule } from './modules/notification-preference/notification-preference.module';
import { IncidentModule } from './modules/incident/incident.module';
import { GradeModule } from './modules/grade/grade.module';
import { MonthlyScoreModule } from './modules/monthly-score/monthly-score.module';
import { AiModule } from './modules/ai/ai.module';
import { FeishuBotModule } from './modules/feishu-bot/feishu-bot.module';
import { DatabaseModule } from './database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    TaskModule,
    DashboardModule,
    ProjectModule,
    UserModule,
    NotificationPreferenceModule,
    IncidentModule,
    GradeModule,
    MonthlyScoreModule,
    AiModule,
    FeishuBotModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
