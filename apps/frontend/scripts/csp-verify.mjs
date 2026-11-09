import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDistDir,
  verifyCspManifest,
} from './csp-hash-lib.mjs';

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const distArg =
  process.argv.indexOf('--dist') !== -1
    ? process.argv[process.argv.indexOf('--dist') + 1]
    : undefined;

try {
  const distDir = resolveDistDir(frontendRoot, distArg);
  const { manifest, manifestFile } = verifyCspManifest({ distDir });
  console.log(
    `[csp] manifest verified: build=${manifest.buildId} html=${manifest.htmlFiles.length} hashes=${manifest.uniqueHashCount} header=${manifest.header.value.length}B file=${manifestFile}`,
  );
} catch (error) {
  console.error(`[csp] FAILED: ${error.message}`);
  process.exit(1);
}
