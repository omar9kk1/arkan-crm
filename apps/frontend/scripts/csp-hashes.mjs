import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDistDir,
  writeCspManifest,
} from './csp-hash-lib.mjs';

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

try {
  const distDir = resolveDistDir(frontendRoot);
  const { manifest, manifestFile } = writeCspManifest({ distDir });
  fs.accessSync(manifestFile);
  console.log(
    `[csp] manifest written: build=${manifest.buildId} html=${manifest.htmlFiles.length} routes=${manifest.routeCount ?? 'n/a'} hashes=${manifest.uniqueHashCount} header=${manifest.header.value.length}B -> ${manifestFile}`,
  );
} catch (error) {
  console.error(`[csp] FAILED: ${error.message}`);
  process.exit(1);
}
