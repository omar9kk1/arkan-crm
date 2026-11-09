import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter } from './filters/api-exception.filter';
import { ResponseInterceptor } from './interceptors/response.interceptor';
import { configureTrustProxy } from '../config/trust-proxy';
export function configureApp(app: INestApplication) {
  // Do not advertise the framework in responses.
  const express = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (name: string, value: unknown) => void;
  };
  express.disable?.('x-powered-by');
  // Disabled unless an explicit proxy IP/CIDR list is configured. Never trust
  // blanket forwarded headers from an unknown topology.
  configureTrustProxy(express, process.env.TRUST_PROXY);
  // Baseline hardening for every response (API is JSON + private images).
  // CSP/HSTS are deployment concerns documented in the audit report: this API
  // serves no HTML and may run behind an HTTP-terminating proxy.
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
}
