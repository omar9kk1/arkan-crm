import { isIP } from 'node:net';

/**
 * Parses an explicit trusted-proxy list. Trust proxy is disabled unless the
 * owner explicitly lists proxy IPs/CIDRs; blanket `true`, `*` and hostnames
 * are rejected because they let a direct client spoof X-Forwarded-For.
 */
export type TrustProxyConfig = false | string[];

export function parseTrustProxy(
  raw: string | null | undefined,
): TrustProxyConfig {
  const value = raw?.trim();
  if (!value || /^(false|off|0)$/i.test(value)) return false;
  if (/^(true|\*)$/i.test(value))
    throw new Error(
      'TRUST_PROXY must list explicit proxy IPs/CIDRs; blanket trust is not allowed',
    );

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length)
    throw new Error('TRUST_PROXY contains no usable IP/CIDR entries');

  return entries.map((entry) => {
    const slash = entry.indexOf('/');
    const address = slash === -1 ? entry : entry.slice(0, slash);
    const family = isIP(address);
    if (!family)
      throw new Error(
        `TRUST_PROXY entry must be an IP or CIDR, got "${entry}"`,
      );
    if (slash === -1) return entry;
    const prefixText = entry.slice(slash + 1);
    const prefix = Number(prefixText);
    if (!/^\d+$/.test(prefixText) || !Number.isInteger(prefix))
      throw new Error(`TRUST_PROXY has an invalid CIDR prefix: "${entry}"`);
    const max = family === 4 ? 32 : 128;
    if (prefix < 0 || prefix > max)
      throw new Error(`TRUST_PROXY CIDR prefix is out of range: "${entry}"`);
    return `${address}/${prefix}`;
  });
}

/** Applies validated trust proxy to the Express instance. */
export function configureTrustProxy(
  express: { set?: (name: string, value: unknown) => void },
  raw: string | null | undefined,
): TrustProxyConfig {
  const trust = parseTrustProxy(raw);
  if (trust) express.set?.('trust proxy', trust);
  return trust;
}
