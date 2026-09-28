import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  allowedDevOrigins: ['localhost', '192.168.1.8'],
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@arkan/shared'],
};
export default config;
