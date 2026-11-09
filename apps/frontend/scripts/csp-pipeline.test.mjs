import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCspManifest,
  writeCspManifest,
  verifyCspManifest,
} from './csp-hash-lib.mjs';

const POLICY =
  "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeDist() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkan-csp-test-'));
  const dist = path.join(root, '.next');
  write(path.join(dist, 'BUILD_ID'), 'build-test-1\n');
  write(
    path.join(dist, 'routes-manifest.json'),
    JSON.stringify({
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'Content-Security-Policy-Report-Only', value: POLICY },
          ],
        },
      ],
    }),
  );
  write(
    path.join(dist, 'app-path-routes-manifest.json'),
    JSON.stringify({
      '/page': ['/'],
      '/login/page': ['/login'],
      '/manager/page': ['/manager'],
      '/_not-found/page': ['/_not-found'],
      '/_global-error/page': ['/_global-error'],
    }),
  );
  write(
    path.join(dist, 'server/app/index.html'),
    '<html><script>self.__next_f.push([1,"home"])</script></html>',
  );
  write(
    path.join(dist, 'server/app/login.html'),
    '<html><script>self.__next_f.push([1,"login"])</script><script src="/_next/x.js"></script></html>',
  );
  write(
    path.join(dist, 'server/app/manager.html'),
    '<html><script>self.__next_f.push([1,"manager"])</script></html>',
  );
  write(
    path.join(dist, 'server/app/_not-found.html'),
    '<html><script>self.__next_f.push([1,"404"])</script></html>',
  );
  write(
    path.join(dist, 'server/app/_global-error.html'),
    '<html><script>self.__next_f.push([1,"error"])</script></html>',
  );
  return { root, dist };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('generates a build-specific manifest with hashes and preview policy', () => {
  const { root, dist } = makeDist();
  try {
    const { manifest, manifestFile } = writeCspManifest({ distDir: dist });
    assert.ok(fs.existsSync(manifestFile));
    assert.equal(manifest.buildId, 'build-test-1');
    assert.equal(manifest.header.enforceName, 'Content-Security-Policy');
    assert.ok(manifest.hashes.length >= 4);
    assert.match(manifest.header.value, /script-src 'self' 'sha256-/);
    assert.doesNotMatch(manifest.header.value, /'unsafe-inline'/);
    assert.doesNotMatch(manifest.header.value, /'unsafe-eval'/);
    assert.doesNotMatch(manifest.header.previewValue, /upgrade-insecure-requests/);
    assert.match(manifest.header.value, /upgrade-insecure-requests/);
    const result = verifyCspManifest({ distDir: dist });
    assert.equal(result.manifest.buildId, manifest.buildId);
  } finally {
    cleanup(root);
  }
});

test('fails when the manifest is missing', () => {
  const { root, dist } = makeDist();
  try {
    assert.throws(
      () => verifyCspManifest({ distDir: dist }),
      /manifest is missing/,
    );
  } finally {
    cleanup(root);
  }
});

test('fails when the manifest build ID is stale', () => {
  const { root, dist } = makeDist();
  try {
    writeCspManifest({ distDir: dist });
    const file = path.join(dist, 'csp-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.buildId = 'old-build';
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(
      () => verifyCspManifest({ distDir: dist }),
      /manifest is stale/,
    );
  } finally {
    cleanup(root);
  }
});

test('fails when a hash is missing from the manifest', () => {
  const { root, dist } = makeDist();
  try {
    writeCspManifest({ distDir: dist });
    const file = path.join(dist, 'csp-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.hashes.pop();
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(
      () => verifyCspManifest({ distDir: dist }),
      /hashes do not match/,
    );
  } finally {
    cleanup(root);
  }
});

test('fails when delivered HTML gained an unhashed inline script', () => {
  const { root, dist } = makeDist();
  try {
    writeCspManifest({ distDir: dist });
    fs.appendFileSync(
      path.join(dist, 'server/app/login.html'),
      '<script>window.changed=true</script>',
    );
    assert.throws(
      () => verifyCspManifest({ distDir: dist }),
      /hashes do not match/,
    );
  } finally {
    cleanup(root);
  }
});

test('fails when the manifest header was changed', () => {
  const { root, dist } = makeDist();
  try {
    writeCspManifest({ distDir: dist });
    const file = path.join(dist, 'csp-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.header.value = manifest.header.value.replace(
      "script-src 'self'",
      "script-src 'self' 'unsafe-inline'",
    );
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(
      () => verifyCspManifest({ distDir: dist }),
      /header does not match/,
    );
  } finally {
    cleanup(root);
  }
});

test('fails when a static route has no generated HTML', () => {
  const { root, dist } = makeDist();
  try {
    fs.rmSync(path.join(dist, 'server/app/manager.html'));
    assert.throws(
      () => buildCspManifest({ distDir: dist }),
      /static route HTML is incomplete/,
    );
  } finally {
    cleanup(root);
  }
});

test('fails when the global error page is missing', () => {
  const { root, dist } = makeDist();
  try {
    fs.rmSync(path.join(dist, 'server/app/_global-error.html'));
    assert.throws(
      () => buildCspManifest({ distDir: dist }),
      /global error HTML page is missing/,
    );
  } finally {
    cleanup(root);
  }
});
