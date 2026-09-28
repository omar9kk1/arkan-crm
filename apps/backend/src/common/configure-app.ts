import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter } from './filters/api-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
export function configureApp(app: INestApplication) {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
}
