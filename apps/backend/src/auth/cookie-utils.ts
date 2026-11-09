import type { Response } from 'express';

export interface CookieWriteOptions {
  maxAgeMs: number;
  path: string;
  httpOnly: boolean;
  secure: boolean;
}

/** Reads the first cookie with this exact name from a Cookie header. */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Serializes one host-only, SameSite=Lax cookie. */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieWriteOptions,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`,
    'SameSite=Lax',
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, path: string, secure: boolean): string {
  return serializeCookie(name, '', {
    maxAgeMs: 0,
    path,
    httpOnly: true,
    secure,
  });
}

export function appendSetCookie(response: Response, cookie: string): void {
  response.append('Set-Cookie', cookie);
}
