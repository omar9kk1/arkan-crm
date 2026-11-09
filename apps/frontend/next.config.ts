import type { NextConfig } from 'next';
import path from 'node:path';
import { cspPolicyFromEnvironment } from './lib/csp';

const csp = cspPolicyFromEnvironment(process.env);

const config: NextConfig = {
  allowedDevOrigins: ['localhost', '192.168.1.8'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@arkan/shared'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          ...(csp
            ? [{ key: csp.headerName, value: csp.value }]
            : []),
        ],
      },
    ];
  },
};
export default config;
