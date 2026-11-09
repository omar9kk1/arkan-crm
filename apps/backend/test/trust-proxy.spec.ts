import express from 'express';
import request from 'supertest';
import {
  configureTrustProxy,
  parseTrustProxy,
} from '../src/config/trust-proxy';

function ipApp(rawTrust: string | undefined) {
  const app = express();
  configureTrustProxy(app, rawTrust);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip, protocol: req.protocol, hostname: req.hostname });
  });
  return app;
}

describe('Trusted proxy configuration', () => {
  it('is disabled by default and for explicit false values', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('off')).toBe(false);
  });

  it('rejects blanket trust and hostnames', () => {
    expect(() => parseTrustProxy('true')).toThrow(/blanket trust/);
    expect(() => parseTrustProxy('*')).toThrow(/blanket trust/);
    expect(() => parseTrustProxy('proxy.internal')).toThrow(/IP or CIDR/);
    expect(() => parseTrustProxy('127.0.0.1/33')).toThrow(/out of range/);
    expect(() => parseTrustProxy('2001:db8::1/129')).toThrow(/out of range/);
  });

  it('accepts explicit IPv4/IPv6 addresses and CIDRs', () => {
    expect(parseTrustProxy('127.0.0.1,::1')).toEqual([
      '127.0.0.1',
      '::1',
    ]);
    expect(parseTrustProxy('10.0.0.0/8, 2001:db8::/32')).toEqual([
      '10.0.0.0/8',
      '2001:db8::/32',
    ]);
  });

  it('ignores spoofed forwarded headers while trust proxy is disabled', async () => {
    const response = await request(ipApp(undefined))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.7')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https');
    expect(response.status).toBe(200);
    expect(response.body.ip).toMatch(/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
    expect(response.body.ip).not.toBe('203.0.113.7');
    expect(response.body.protocol).toBe('http');
    expect(response.body.hostname).not.toBe('evil.example');
  });

  it('honors forwarded headers only for explicitly trusted proxies', async () => {
    const response = await request(ipApp('127.0.0.1/32,::1/128'))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.7');
    expect(response.status).toBe(200);
    expect(response.body.ip).toBe('203.0.113.7');
  });

  it('supports an IPv6 client address when the proxy list is explicit', async () => {
    const response = await request(ipApp('127.0.0.1/32,::1/128'))
      .get('/ip')
      .set('X-Forwarded-For', '2001:db8::42');
    expect(response.status).toBe(200);
    expect(response.body.ip).toBe('2001:db8::42');
  });
});
