import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Recognises a multer upload error (e.g. a file that exceeds the size limit) by its
 * `LIMIT_*` code. `@types/multer` is not installed, so the shape is duck-typed
 * instead of importing the class.
 */
function multerErrorCode(exception: unknown): string | null {
  if (!exception || typeof exception !== 'object') return null;
  const code = (exception as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('LIMIT_') ? code : null;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const multerCode = multerErrorCode(exception);
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    let status: number;
    let message: unknown;
    if (multerCode) {
      status = multerCode === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message =
        multerCode === 'LIMIT_FILE_SIZE'
          ? 'The uploaded file exceeds the maximum allowed size.'
          : 'Only a single image field named "image" is accepted.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message =
        typeof body === 'string'
          ? body
          : body && typeof body === 'object' && 'message' in body
            ? (body as { message: unknown }).message
            : 'Internal server error';
    } else {
      status = 500;
      message = 'Internal server error';
    }

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
