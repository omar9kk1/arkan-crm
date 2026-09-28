import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof body === 'string'
        ? body
        : body && 'message' in body
          ? body.message
          : 'Internal server error';
    if (status >= 500)
      this.logger.error(
        exception instanceof Error ? exception.stack : 'Unexpected error',
      );
    context
      .getResponse<Response>()
      .status(status)
      .json({
        error: {
          statusCode: status,
          message,
          path: context.getRequest<Request>().path,
        },
      });
  }
}
