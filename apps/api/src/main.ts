import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

// 生产启动硬校验：JWT_SECRET 缺失 / 默认值 / 过短 → 拒绝启动（fail-closed）。
// 防止误用示例 .env 的默认密钥上线——那会让任何人伪造 admin token（纵深防御）。
function assertProdSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const s = process.env.JWT_SECRET ?? '';
  if (!s || s === 'change-me-in-production' || s.length < 24) {
    throw new Error(
      'FATAL: JWT_SECRET 未设置 / 仍是默认值 / 长度不足 24——生产环境拒绝启动。请设置足够强度的随机密钥。',
    );
  }
}

async function bootstrap() {
  assertProdSecrets();
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.API_PORT || 3001;
  await app.listen(port);
  console.log(`API server running on port ${port}`);
}
bootstrap();
