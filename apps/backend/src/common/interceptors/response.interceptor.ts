import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import type { ApiResponse } from '@arkan/shared';
import { RAW_RESPONSE } from '../decorators/raw-response.decorator';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    if (this.reflector.get<boolean>(RAW_RESPONSE, context.getHandler()))
      return next.handle();
    return next.handle().pipe(map((data) => ({ data })));
  }
}
