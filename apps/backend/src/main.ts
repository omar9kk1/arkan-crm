import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  configureApp(app);
  app.enableCors({
    origin: [
      ...new Set([
        ...config
          .getOrThrow<string>('FRONTEND_ORIGIN')
          .split(',')
          .map((origin) => origin.trim()),
        'http://localhost:3000',
        'http://192.168.1.8:3000',
      ]),
    ],
  });
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}
void bootstrap();
