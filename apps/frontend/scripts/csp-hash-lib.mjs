import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_NAME = 'csp-manifest.json';

function fail(message) {
  throw new Error(message);
}

export function resolveDistDir(frontendRoot, distDir) {
  return path.resolve(frontendRoot, distDir || process.env.CSP_DIST_DIR || '.next');
}

function walkFiles(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(absolute));
    else out.push(absolute);
  }
  return out;
}

export function listHtmlFiles(distDir) {
  const appDir = path.join(distDir, 'server', 'app');
  if (!fs.existsSync(appDir))
    fail(`CSP: Next app HTML directory is missing: ${appDir}`);
  return walkFiles(appDir)
    .filter((file) => file.toLowerCase().endsWith('.html'))
    .map((file) => path.relative(distDir, file).split(path.sep).join('/'))
    .sort();
}

export function extractInlineScripts(html) {
  const scripts = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const attrs = match[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const content = match[2];
    if (!content.length) continue;
    scripts.push(content);
  }
  return scripts;
}

export function hashInlineScripts(html) {
  return extractInlineScripts(html).map(
    (content) =>
      `'sha256-${crypto.createHash('sha256').update(content).digest('base64')}'`,
  );
}

export function collectHashes(distDir) {
  const htmlFiles = listHtmlFiles(distDir);
  if (!htmlFiles.length) fail('CSP: no generated application HTML was found');
  const hashes = new Set();
  let inlineScriptCount = 0;
  for (const relative of htmlFiles) {
    const html = fs.readFileSync(path.join(distDir, relative), 'utf8');
    const pageHashes = hashInlineScripts(html);
    inlineScriptCount += pageHashes.length;
    for (const hash of pageHashes) hashes.add(hash);
  }
  if (!hashes.size)
    fail('CSP: generated HTML contains no inline scripts to authorize');
  const sorted = [...hashes].sort();
  return { htmlFiles, hashes: sorted, inlineScriptCount };
}

function readBuildId(distDir) {
  const file = path.join(distDir, 'BUILD_ID');
  if (!fs.existsSync(file))
    fail(`CSP: BUILD_ID is missing at ${file}. Build the app first.`);
  const buildId = fs.readFileSync(file, 'utf8').trim();
  if (!buildId) fail('CSP: BUILD_ID is empty');
  return buildId;
}

function findCspHeader(distDir) {
  const file = path.join(distDir, 'routes-manifest.json');
  if (!fs.existsSync(file))
    fail(`CSP: routes-manifest.json is missing at ${file}`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const headers = Array.isArray(manifest.headers) ? manifest.headers : [];
  for (const entry of headers) {
    for (const header of entry.headers || []) {
      if (
        header.key === 'Content-Security-Policy' ||
        header.key === 'Content-Security-Policy-Report-Only'
      ) {
        return { name: header.key, value: String(header.value || '') };
      }
    }
  }
  fail(
    'CSP: the build emitted no Content-Security-Policy header. Set CSP_MODE=report-only (or enforce) before building.',
  );
}

function splitDirectives(value) {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function directiveParts(part) {
  const [name, ...sources] = part.split(/\s+/);
  return { name, sources };
}

function joinDirectives(parts) {
  return parts.map(({ name, sources }) => `${name} ${sources.join(' ')}`).join('; ');
}

function assertStrongScriptPolicy(parts) {
  for (const name of ['script-src', 'script-src-elem']) {
    const directive = parts.find((item) => item.name === name);
    if (!directive) {
      if (name === 'script-src') fail('CSP: the policy has no script-src');
      continue;
    }
    if (
      directive.sources.includes("'unsafe-inline'") ||
      directive.sources.includes("'unsafe-eval'")
    )
      fail(
        `CSP: refusing to build the hash manifest because ${name} contains unsafe-inline/unsafe-eval`,
      );
  }
  for (const required of ['object-src', 'base-uri', 'frame-ancestors']) {
    if (!parts.find((item) => item.name === required))
      fail(`CSP: the policy is missing required directive ${required}`);
  }
}

function addHashesToPolicy(value, hashes) {
  const parts = splitDirectives(value).map(directiveParts);
  assertStrongScriptPolicy(parts);
  const hashSet = new Set(hashes);
  for (const name of ['script-src', 'script-src-elem']) {
    const directive = parts.find((item) => item.name === name);
    if (!directive) continue;
    for (const hash of hashSet) {
      if (!directive.sources.includes(hash)) directive.sources.push(hash);
    }
  }
  return joinDirectives(parts);
}

function previewPolicy(value) {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^upgrade-insecure-requests\b/.test(item))
    .join('; ');
}

function routeManifest(distDir) {
  const file = path.join(distDir, 'app-path-routes-manifest.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routeToHtml(route) {
  if (!route.endsWith('/page')) return null;
  const clean = route.slice(0, -'/page'.length);
  if (!clean) return 'server/app/index.html';
  const relative = clean.replace(/^\//, '');
  return `server/app/${relative}.html`;
}

function assertRouteCoverage(distDir, htmlFiles) {
  const routes = routeManifest(distDir);
  if (!routes) return null;
  const present = new Set(htmlFiles);
  const missing = [];
  const staticRoutes = [];
  for (const route of Object.keys(routes)) {
    if (route.includes('[')) continue;
    const html = routeToHtml(route);
    if (!html) continue;
    staticRoutes.push(route);
    if (!present.has(html)) missing.push({ route, html });
  }
  if (missing.length)
    fail(
      `CSP: static route HTML is incomplete: ${missing
        .map((item) => `${item.route} -> ${item.html}`)
        .join(', ')}`,
    );
  return staticRoutes.length;
}

function assertErrorPages(htmlFiles) {
  if (
    !htmlFiles.some((file) =>
      /(^|\/)(_not-found|404)\.html$/i.test(file),
    )
  )
    fail('CSP: the 404 HTML page is missing from the build');
  if (!htmlFiles.some((file) => /(^|\/)_global-error\.html$/i.test(file)))
    fail('CSP: the global error HTML page is missing from the build');
}

export function buildCspManifest({ distDir }) {
  assertErrorPages(listHtmlFiles(distDir));
  const { htmlFiles, hashes, inlineScriptCount } = collectHashes(distDir);
  assertErrorPages(htmlFiles);
  const routeCount = assertRouteCoverage(distDir, htmlFiles);
  const buildId = readBuildId(distDir);
  const source = findCspHeader(distDir);
  const value = addHashesToPolicy(source.value, hashes);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    tool: 'arkan-csp-hash-pipeline',
    buildId,
    generatedAt: new Date().toISOString(),
    sourceHeader: source.name,
    htmlFiles,
    routeCount,
    inlineScriptCount,
    uniqueHashCount: hashes.length,
    hashes,
    header: {
      enforceName: 'Content-Security-Policy',
      reportOnlyName: 'Content-Security-Policy-Report-Only',
      value,
      previewValue: previewPolicy(value),
    },
  };
}

export function verifyCspManifest({ distDir, manifestPath }) {
  const manifestFile =
    manifestPath || path.join(distDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestFile))
    fail(
      `CSP manifest is missing at ${manifestFile}. Run the production build (including the postbuild CSP step).`,
    );
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    fail(`CSP manifest is not valid JSON: ${error.message}`);
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION)
    fail(`CSP manifest schema mismatch: ${manifest.schemaVersion}`);
  if (!Array.isArray(manifest.hashes) || !manifest.hashes.length)
    fail('CSP manifest contains no hashes');
  if (!Array.isArray(manifest.htmlFiles) || !manifest.htmlFiles.length)
    fail('CSP manifest contains no HTML files');
  if (!manifest.header?.value || !manifest.header?.previewValue)
    fail('CSP manifest contains no header values');

  const buildId = readBuildId(distDir);
  if (manifest.buildId !== buildId)
    fail(
      `CSP manifest is stale: manifest build ${manifest.buildId} != current build ${buildId}`,
    );

  const current = collectHashes(distDir);
  if (
    JSON.stringify(current.htmlFiles) !== JSON.stringify(manifest.htmlFiles)
  )
    fail('CSP manifest HTML file list is incomplete or stale');
  if (JSON.stringify(current.hashes) !== JSON.stringify(manifest.hashes))
    fail('CSP manifest hashes do not match the delivered inline scripts');

  const source = findCspHeader(distDir);
  const expected = addHashesToPolicy(source.value, current.hashes);
  if (manifest.header.value !== expected)
    fail('CSP manifest header does not match the current build policy and hashes');
  if (manifest.header.previewValue !== previewPolicy(expected))
    fail('CSP manifest preview header does not match the current build policy');

  const parts = splitDirectives(expected).map(directiveParts);
  assertStrongScriptPolicy(parts);
  assertErrorPages(current.htmlFiles);
  assertRouteCoverage(distDir, current.htmlFiles);

  return { manifest, manifestFile };
}

export function writeCspManifest({ distDir }) {
  const manifest = buildCspManifest({ distDir });
  const target = path.join(distDir, MANIFEST_NAME);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  try {
    verifyCspManifest({ distDir, manifestPath: temporary });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  fs.renameSync(temporary, target);
  return { manifest, manifestFile: target };
}

export { MANIFEST_NAME };
