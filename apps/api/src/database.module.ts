import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDb, type Database } from '@leader-sync/db';

export const DATABASE_TOKEN = 'DATABASE';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_TOKEN,
      useFactory: (config: ConfigService): Database => {
        const url = config.getOrThrow<string>('DATABASE_URL');
        return createDb(url);
      },
      inject: [ConfigService],
    },
  ],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
