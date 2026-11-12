/*
 * Shared, fail-closed configuration for the local load-test scripts.
 *
 * Nothing here has a usable default: every script that touches PostgreSQL or
 * the test API must be given an explicit environment configuration. This keeps
 * real credentials out of the repository and makes it impossible to silently
 * fall back to the development database or the real backend on port 4001.
 */
const os = require('node:os');
const path = require('node:path');

const LOAD_DB = 'arkan_crm_load_test';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const FORBIDDEN_API_PORTS = new Set(['4001']);

function fail(message) {
  throw new Error(`[load-test] ${message}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(
      `${name} is required. Set it explicitly for the disposable ` +
        `"${LOAD_DB}" load-test environment.`,
    );
  }
  return value;
}

/** Validates and returns the disposable load-test PostgreSQL URL. */
function loadDatabaseUrl() {
  const raw = requiredEnv('LOAD_DATABASE_URL');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('LOAD_DATABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail('LOAD_DATABASE_URL must use the postgresql:// scheme.');
  }
  let database;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    fail('LOAD_DATABASE_URL has an invalid database name.');
  }
  if (database !== LOAD_DB) {
    fail(
      `Refusing database "${database || '(missing)'}"; only "${LOAD_DB}" ` +
        'may be used by load-test scripts.',
    );
  }
  return raw;
}

/** Validates and returns the explicit loopback test-API base URL. */
function loadApiBaseUrl() {
  const raw = requiredEnv('LOAD_API_URL');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('LOAD_API_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('LOAD_API_URL must use http:// or https://.');
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    fail(
      'LOAD_API_URL must target a loopback test backend ' +
        '(127.0.0.1, localhost or ::1).',
    );
  }
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (FORBIDDEN_API_PORTS.has(port)) {
    fail('LOAD_API_URL must not target the real development API on port 4001.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('LOAD_API_URL must be a base origin without a path or query.');
  }
  return raw.replace(/\/$/, '');
}

/** The shared password injected into generated load-test accounts. */
function loadTestPassword() {
  return requiredEnv('LOAD_TEST_PASSWORD');
}

const STATE_FILE =
  process.env.LOAD_STATE_FILE?.trim() ||
  path.join(os.tmpdir(), 'arkan-crm-load-state.json');
const PID_FILE =
  process.env.LOAD_BACKEND_PID_FILE?.trim() ||
  path.join(os.tmpdir(), 'arkan-load-backend.pid');

/**
 * Enforces the second database guard after connecting. Even a correctly-shaped
 * URL is rejected when PostgreSQL reports any other current_database().
 */
async function assertLoadDatabase(prisma) {
  const rows = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  const database = rows?.[0]?.db;
  if (database !== LOAD_DB) {
    try {
      await prisma.$disconnect();
    } catch {
      // Ignore disconnect failures: the safety error below is the real result.
    }
    fail(
      `Connected database is "${database || '(unknown)'}"; expected ` +
        `"${LOAD_DB}". Aborting before any load-test work.`,
    );
  }
  return database;
}

module.exports = {
  LOAD_DB,
  loadDatabaseUrl,
  loadApiBaseUrl,
  loadTestPassword,
  assertLoadDatabase,
  STATE_FILE,
  PID_FILE,
};
