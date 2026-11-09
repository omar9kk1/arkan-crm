import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  resolveDistDir,
  verifyCspManifest,
} from './csp-hash-lib.mjs';

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const distDir = resolveDistDir(frontendRoot);
const previewPort = Number(process.env.CSP_PREVIEW_PORT || '3001');
const upstreamPort = Number(process.env.CSP_PREVIEW_UPSTREAM_PORT || '3101');

function fail(message) {
  console.error(`[csp-preview] ${message}`);
  process.exit(1);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function findStandaloneServer(distDir) {
  const root = path.join(distDir, 'standalone');
  if (!fs.existsSync(root)) return null;
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'server.js') found.push(file);
    }
  };
  walk(root);
  if (!found.length) return null;
  return (
    found.find((file) =>
      file.includes(`${path.sep}apps${path.sep}frontend${path.sep}server.js`),
    ) || found.sort((a, b) => a.length - b.length)[0]
  );
}

function prepareStandalone(serverFile, distDir, frontendRoot) {
  const standaloneDir = path.dirname(serverFile);
  const staticSource = path.join(distDir, 'static');
  const staticTarget = path.join(standaloneDir, '.next', 'static');
  if (fs.existsSync(staticSource))
    fs.cpSync(staticSource, staticTarget, { recursive: true, force: true });
  const publicSource = path.join(frontendRoot, 'public');
  const publicTarget = path.join(standaloneDir, 'public');
  if (fs.existsSync(publicSource))
    fs.cpSync(publicSource, publicTarget, { recursive: true, force: true });
  return standaloneDir;
}

async function waitForUpstream(url, child) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Next.js exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status > 0) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Next.js did not become ready within 60 seconds');
}

let verified;
try {
  verified = verifyCspManifest({ distDir });
} catch (error) {
  fail(error.message);
}
const { manifest } = verified;

if (previewPort === upstreamPort)
  fail('CSP_PREVIEW_PORT and CSP_PREVIEW_UPSTREAM_PORT must differ');
if (!(await isPortFree(previewPort)))
  fail(
    `port ${previewPort} is already in use. Stop the development frontend first (the preview uses the real local origin for cookie/CORS compatibility).`,
  );
if (!(await isPortFree(upstreamPort)))
  fail(`upstream port ${upstreamPort} is already in use`);

if (previewPort !== 3001)
  console.warn(
    `[csp-preview] warning: origin http://localhost:${previewPort} must also be allowed by the backend CORS/FRONTEND_ORIGIN configuration.`,
  );

const require = createRequire(import.meta.url);
const standaloneServer = findStandaloneServer(distDir);
let child;
let serverMode;
if (standaloneServer) {
  const standaloneDir = prepareStandalone(
    standaloneServer,
    distDir,
    frontendRoot,
  );
  serverMode = 'standalone';
  child = spawn(process.execPath, [standaloneServer], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(upstreamPort),
      HOSTNAME: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
} else {
  const nextBin = require.resolve('next/dist/bin/next');
  serverMode = 'next-start';
  child = spawn(
    process.execPath,
    [nextBin, 'start', '-p', String(upstreamPort)],
    {
      cwd: frontendRoot,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}
const prefix = (line) => console.log(`[next-start] ${line}`);
child.stdout.on('data', (chunk) => {
  for (const line of String(chunk).split(/\r?\n/).filter(Boolean))
    prefix(line);
});
child.stderr.on('data', (chunk) => {
  for (const line of String(chunk).split(/\r?\n/).filter(Boolean))
    console.error(`[next-start] ${line}`);
});
child.once('exit', (code, signal) => {
  if (code !== 0 && signal !== 'SIGTERM')
    console.error(`[csp-preview] Next.js exited: code=${code} signal=${signal}`);
});

const proxy = http.createServer((request, response) => {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${upstreamPort}`,
      },
    },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      if (/text\/html/i.test(headers['content-type'] || ''))
        headers['content-security-policy'] = manifest.header.previewValue;
      response.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
    response.end('CSP preview upstream unavailable');
  });
  request.pipe(upstream);
});

function shutdown(code = 0) {
  try {
    proxy.close();
  } catch {
    /* already closed */
  }
  if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 150);
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

try {
  await waitForUpstream(`http://127.0.0.1:${upstreamPort}/login`, child);
  proxy.listen(previewPort, '127.0.0.1', () => {
    console.log(
      `[csp-preview] ENFORCED CSP preview: http://localhost:${previewPort} (upstream ${upstreamPort}, ${serverMode})`,
    );
    console.log(
      `[csp-preview] build=${manifest.buildId} html=${manifest.htmlFiles.length} hashes=${manifest.uniqueHashCount} header=${manifest.header.value.length}B`,
    );
    console.log(
      '[csp-preview] local HTTP preview strips upgrade-insecure-requests from the manifest; production deployments must use the full header over HTTPS.',
    );
  });
} catch (error) {
  shutdown(1);
  fail(error.message);
}
