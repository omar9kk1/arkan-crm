import { BadRequestException } from '@nestjs/common';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Web Push endpoint security.
 *
 * A browser subscription endpoint is a URL chosen by the BROWSER, but it is
 * persisted from an authenticated request. It must never be treated as a
 * generic "send an HTTP request here" capability: without a destination
 * allowlist, a malicious manager could register an internal HTTPS URL and use
 * the server as an SSRF proxy.
 *
 * Protection is applied twice:
 *   1. at registration time (`parseAllowedPushEndpoint`), and
 *   2. at the actual HTTPS connection (`createSafePushLookup` + `SAFE_PUSH_AGENT`),
 *      where the hostname is re-checked and every resolved IP is validated
 *      before Node opens the socket. The address used for the connection is
 *      the same address that was validated, so a second DNS answer cannot
 *      rebind the connection to a private target.
 */

/** Maximum accepted endpoint length (also enforced by the DTO). */
export const MAX_PUSH_ENDPOINT_LENGTH = 2048;

/** No push provider is expected to need more than ten seconds. */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** Bound the DNS phase too; the HTTPS timeout starts after DNS completes. */
export const PUSH_DNS_TIMEOUT_MS = 5_000;

export class PushEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushEndpointError';
  }
}

/**
 * Exact hosts of the production push services used by the supported browsers.
 *
 * Chrome / Chromium (including Edge's Chromium engine, Opera, Samsung):
 *   https://fcm.googleapis.com/fcm/send/<id>
 * Firefox:
 *   https://updates.push.services.mozilla.com/wpush/v2/<id>
 * Safari (macOS 13+/iOS 16.4+):
 *   https://web.push.apple.com/<id>
 */
const EXACT_PROVIDER_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

/**
 * Two providers publish a wildcard namespace in their official docs, so their
 * regional endpoints cannot be enumerated:
 *
 * - Microsoft Edge (WNS): docs require `*.notify.windows.com`; real endpoints
 *   look like `wns2-by3p.notify.windows.com`, `dm3p.notify.windows.com`, or
 *   `cloud.notify.windows.com`.
 * - Apple: WWDC22 says to allow any subdomain of `push.apple.com`; the live
 *   endpoint is `web.push.apple.com`.
 *
 * These are deliberately ONE-LABEL, anchored patterns on provider-controlled
 * domains. They are not substring checks and cannot match an attacker domain
 * such as `evil-notify.windows.com.attacker.example`.
 */
const PROVIDER_SUBDOMAIN_PATTERNS: readonly RegExp[] = [
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.notify\.windows\.com$/,
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.push\.apple\.com$/,
];

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Rejects whitespace/control characters and backslashes before URL parsing. */
function hasUnsafeRawCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || character === '\\') return true;
  }
  return false;
}

/**
 * Non-public address ranges, including loopback, RFC1918/ULA, link-local,
 * CGNAT, multicast, documentation/benchmark ranges, IPv4-mapped IPv6, NAT64
 * and the common cloud metadata endpoints (all live inside these ranges).
 */
const BLOCKED_ADDRESSES = new BlockList();
const block = (address: string, prefix: number, type: 'ipv4' | 'ipv6') =>
  BLOCKED_ADDRESSES.addSubnet(address, prefix, type);

// IPv4
block('0.0.0.0', 8, 'ipv4');
block('10.0.0.0', 8, 'ipv4');
block('100.64.0.0', 10, 'ipv4'); // CGNAT
block('127.0.0.0', 8, 'ipv4');
block('169.254.0.0', 16, 'ipv4'); // link-local + 169.254.169.254 metadata
block('172.16.0.0', 12, 'ipv4');
block('192.0.0.0', 24, 'ipv4');
block('192.0.2.0', 24, 'ipv4');
block('192.168.0.0', 16, 'ipv4');
block('198.18.0.0', 15, 'ipv4');
block('198.51.100.0', 24, 'ipv4');
block('203.0.113.0', 24, 'ipv4');
block('224.0.0.0', 4, 'ipv4'); // multicast
block('240.0.0.0', 4, 'ipv4'); // reserved + broadcast
block('255.255.255.255', 32, 'ipv4');

// IPv6
block('::', 96, 'ipv6'); // unspecified + IPv4-compatible + loopback
block('64:ff9b::', 96, 'ipv6'); // NAT64
block('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64
block('100::', 64, 'ipv6'); // discard
block('2001::', 32, 'ipv6'); // Teredo
block('2001:2::', 48, 'ipv6'); // benchmarking
block('2001:10::', 28, 'ipv6'); // ORCHID
block('2001:20::', 28, 'ipv6'); // ORCHIDv2
block('2001:db8::', 32, 'ipv6'); // documentation
block('2002::', 16, 'ipv6'); // 6to4
block('fc00::', 7, 'ipv6'); // unique local
block('fe80::', 10, 'ipv6'); // link-local
block('ff00::', 8, 'ipv6'); // multicast

/** True only for a syntactically valid, globally routable IP address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  // Reject every IPv4-mapped IPv6 form, including public-looking ones. They
  // are never a legitimate DNS answer from a HTTPS push provider and are a
  // common bypass shape for loopback/metadata checks.
  if (family === 6 && /^::ffff:/i.test(address)) return false;
  return !BLOCKED_ADDRESSES.check(
    address,
    family === 4 ? 'ipv4' : 'ipv6',
  );
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/** Lowercase, syntax-checked host (no trailing dot, no IP literals). */
export function normalizePushHost(hostname: string): string {
  const host = stripIpv6Brackets(hostname).toLowerCase();
  if (!host || host.length > 253 || host.endsWith('.')) return '';
  if (isIP(host) !== 0) return '';
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label)))
    return '';
  return host;
}

/** True only for the exact official provider hosts/namespaces. */
export function isAllowedPushHost(hostname: string): boolean {
  const host = normalizePushHost(hostname);
  if (!host) return false;
  if (EXACT_PROVIDER_HOSTS.has(host)) return true;
  return PROVIDER_SUBDOMAIN_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Parses and validates one endpoint for registration or delivery.
 * Throws PushEndpointError on any shape/destination violation.
 */
export function parseAllowedPushEndpoint(endpoint: string): URL {
  if (typeof endpoint !== 'string' || endpoint.length === 0)
    throw new PushEndpointError('Push endpoint is required');
  if (endpoint.length > MAX_PUSH_ENDPOINT_LENGTH)
    throw new PushEndpointError('Push endpoint is too long');
  if (hasUnsafeRawCharacter(endpoint))
    throw new PushEndpointError('Push endpoint contains unsafe characters');

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PushEndpointError('Push endpoint is not a valid URL');
  }

  if (url.protocol !== 'https:')
    throw new PushEndpointError('Push endpoint must use HTTPS');
  if (url.username || url.password)
    throw new PushEndpointError('Push endpoint must not contain credentials');
  if (url.hash)
    throw new PushEndpointError('Push endpoint must not contain a fragment');
  // URL normalises the default :443 port to an empty string. Any other port
  // (including :80, :8443, :3000) is rejected.
  if (url.port !== '')
    throw new PushEndpointError('Push endpoint must use the secure default port');
  if (url.protocol === 'https:' && url.hostname === '')
    throw new PushEndpointError('Push endpoint host is missing');
  if (!isAllowedPushHost(url.hostname))
    throw new PushEndpointError('Push endpoint host is not an approved push service');

  return url;
}

/** API-facing wrapper that maps the validation failure to a safe 400. */
export function assertAllowedPushEndpoint(endpoint: string): URL {
  try {
    return parseAllowedPushEndpoint(endpoint);
  } catch (error) {
    if (error instanceof PushEndpointError)
      throw new BadRequestException(
        'Push endpoint must be an HTTPS URL provided by a supported browser push service.',
      );
    throw error;
  }
}

type ResolverCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: LookupAddress[],
) => void;
type Resolver = (
  hostname: string,
  options: { all: true; family?: number; hints?: number; verbatim: true },
  callback: ResolverCallback,
) => void;
type LookupOptionsLike = { all?: boolean; family?: number; hints?: number };
export type SafeLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Builds the `lookup` used by SAFE_PUSH_AGENT.
 *
 * Node's `https.Agent` passes this function to the TLS socket creation, so it
 * runs at CONNECT time. It resolves the hostname once, rejects if ANY returned
 * address is non-public, and returns the very same address(es) Node will
 * connect to. There is no second resolution between validation and connect.
 */
export function createSafePushLookup(
  resolve: Resolver = dnsLookup as unknown as Resolver,
): (hostname: string, options: LookupOptionsLike, callback: SafeLookupCallback) => void {
  return (hostname, options, callback) => {
    if (!isAllowedPushHost(hostname)) {
      callback(
        Object.assign(new Error('Push endpoint host is not approved'), {
          code: 'EPUSHENDPOINT',
        }),
      );
      return;
    }

    let settled = false;
    const timer: { id?: NodeJS.Timeout } = {};
    const finish: SafeLookupCallback = (error, address, family) => {
      if (settled) return;
      settled = true;
      if (timer.id) clearTimeout(timer.id);
      callback(error, address, family);
    };
    timer.id = setTimeout(() => {
      finish(
        Object.assign(new Error('Push endpoint DNS lookup timed out'), {
          code: 'EPUSHENDPOINT',
        }),
      );
    }, PUSH_DNS_TIMEOUT_MS);
    timer.id.unref?.();

    resolve(
      hostname,
      {
        all: true,
        family: options.family,
        hints: options.hints,
        verbatim: true,
      },
      (error, addresses) => {
        if (error) {
          finish(error);
          return;
        }
        if (!addresses.length) {
          finish(
            Object.assign(new Error('Push endpoint did not resolve'), {
              code: 'EPUSHENDPOINT',
            }),
          );
          return;
        }
        if (addresses.some((entry) => !isPublicAddress(entry.address))) {
          finish(
            Object.assign(new Error('Push endpoint resolved to a non-public address'), {
              code: 'EPUSHENDPOINT',
            }),
          );
          return;
        }

        if (options.all) {
          finish(null, addresses);
          return;
        }
        // Prefer IPv4 for maximum reachability when the caller did not ask for
        // the full Happy Eyeballs candidate list.
        const chosen =
          addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
        finish(null, chosen.address, chosen.family);
      },
    );
  };
}

/**
 * Agent attached to every outbound push. `keepAlive` is off so each send goes
 * through the connection-time lookup above; the TLS SNI/certificate checks
 * still use the original hostname, never the resolved IP.
 */
export const SAFE_PUSH_AGENT = new https.Agent({
  keepAlive: false,
  lookup: createSafePushLookup() as unknown as https.AgentOptions['lookup'],
});
