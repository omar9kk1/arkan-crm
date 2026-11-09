import {
  createSafePushLookup,
  isAllowedPushHost,
  isPublicAddress,
  parseAllowedPushEndpoint,
  PushEndpointError,
  SAFE_PUSH_AGENT,
} from '../src/push/push-endpoint';
import type { LookupAddress } from 'node:dns';

const VALID_ENDPOINTS = [
  'https://fcm.googleapis.com/fcm/send/abc123',
  'https://updates.push.services.mozilla.com/wpush/v2/abc123',
  'https://web.push.apple.com/abc123',
  'https://foo.push.apple.com/abc123',
  'https://wns2-by3p.notify.windows.com/?token=abc123',
  'https://dm3p.notify.windows.com/abc123',
  'https://cloud.notify.windows.com/?token=abc123',
  'https://FCM.GOOGLEAPIS.COM/fcm/send/abc123',
  'https://fcm.googleapis.com:443/fcm/send/abc123',
];

const INVALID_ENDPOINTS = [
  'not-a-url',
  'https://',
  'http://fcm.googleapis.com/fcm/send/abc',
  'ftp://fcm.googleapis.com/fcm/send/abc',
  'https://fcm.googleapis.com:8443/fcm/send/abc',
  'https://fcm.googleapis.com:80/fcm/send/abc',
  'https://user:pass@fcm.googleapis.com/fcm/send/abc',
  'https://user@fcm.googleapis.com/fcm/send/abc',
  'https://fcm.googleapis.com/fcm/send/abc#fragment',
  'https://fcm.googleapis.com.evil.example/fcm/send/abc',
  'https://evilfcm.googleapis.com/fcm/send/abc',
  'https://fcm.googleapis.com.evil.example/fcm/send/abc',
  'https://evil.example/fcm.googleapis.com',
  'https://evil.example\\@fcm.googleapis.com/fcm/send/abc',
  'https://fcm.googleapis.com/fcm/send/abc?x= y',
  'https://localhost/fcm/send/abc',
  'https://127.0.0.1/fcm/send/abc',
  'https://0x7f000001/fcm/send/abc',
  'https://[::1]/fcm/send/abc',
  'https://[::ffff:127.0.0.1]/fcm/send/abc',
  'https://127.1/fcm/send/abc',
  'https://2130706433/fcm/send/abc',
  'https://169.254.169.254/latest/meta-data',
  'https://10.0.0.5/fcm/send/abc',
  'https://192.168.1.5/fcm/send/abc',
  'https://172.16.0.5/fcm/send/abc',
  'https://100.100.100.200/latest/meta-data',
  'https://[fd00:ec2::254]/latest/meta-data',
  'https://fcm.googleapis.com./fcm/send/abc',
  'https://notify.windows.com/',
  'https://a.b.notify.windows.com/',
  'https://evil-notify.windows.com.attacker.example/',
  'https://notify.windows.com.attacker.example/',
  'https://push.apple.com/',
  'https://a.b.push.apple.com/',
  'https://push.apple.com.attacker.example/',
  'https://127.0.0.1.nip.io/fcm/send/abc',
];

function runLookup(
  lookup: ReturnType<typeof createSafePushLookup>,
  hostname: string,
  all = true,
): Promise<{ address?: string | LookupAddress[]; family?: number }> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all, family: 0, hints: 0 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

function fakeResolver(addresses: LookupAddress[]) {
  const calls: Array<{
    hostname: string;
    options: { all: true; family?: number; hints?: number; verbatim: true };
  }> = [];
  const resolve = (
    hostname: string,
    options: { all: true; family?: number; hints?: number; verbatim: true },
    callback: (
      error: NodeJS.ErrnoException | null,
      result: LookupAddress[],
    ) => void,
  ) => {
    calls.push({ hostname, options });
    callback(null, addresses);
  };
  return { calls, lookup: createSafePushLookup(resolve) };
}

describe('Web Push endpoint allowlist', () => {
  it('accepts the official browser push services', () => {
    for (const endpoint of VALID_ENDPOINTS) {
      expect(() => parseAllowedPushEndpoint(endpoint)).not.toThrow();
    }
  });

  it('normalises the host and keeps the original provider path', () => {
    const url = parseAllowedPushEndpoint(
      'https://FCM.GOOGLEAPIS.COM:443/fcm/send/ABC?x=1',
    );
    expect(url.hostname).toBe('fcm.googleapis.com');
    expect(url.port).toBe('');
    expect(url.pathname).toBe('/fcm/send/ABC');
    expect(url.search).toBe('?x=1');
  });

  it('rejects malformed, private, misleading and non-provider destinations', () => {
    for (const endpoint of INVALID_ENDPOINTS) {
      expect(() => parseAllowedPushEndpoint(endpoint)).toThrow(
        PushEndpointError,
      );
    }
  });

  it('recognises only exact hosts and the documented provider namespaces', () => {
    expect(isAllowedPushHost('fcm.googleapis.com')).toBe(true);
    expect(isAllowedPushHost('updates.push.services.mozilla.com')).toBe(true);
    expect(isAllowedPushHost('web.push.apple.com')).toBe(true);
    expect(isAllowedPushHost('foo.push.apple.com')).toBe(true);
    expect(isAllowedPushHost('wns2-by3p.notify.windows.com')).toBe(true);
    expect(isAllowedPushHost('dm3p.notify.windows.com')).toBe(true);
    expect(isAllowedPushHost('notify.windows.com')).toBe(false);
    expect(isAllowedPushHost('a.b.notify.windows.com')).toBe(false);
    expect(isAllowedPushHost('push.apple.com')).toBe(false);
    expect(isAllowedPushHost('fcm.googleapis.com.evil.example')).toBe(false);
    expect(isAllowedPushHost('evil-notify.windows.com.attacker.example')).toBe(
      false,
    );
  });
});

describe('Web Push connection-time address validation', () => {
  it('blocks loopback, private, link-local, CGNAT and metadata addresses', () => {
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.100.100.200',
      '224.0.0.1',
      '::1',
      '::',
      '::127.0.0.1',
      '2001::1',
      '2002:7f00:1::1',
      'fe80::1',
      'fc00::1',
      'fd00:ec2::254',
      '::ffff:127.0.0.1',
      'ff02::1',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it('accepts public IPv4 and IPv6 addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects an untrusted host before DNS is even consulted', async () => {
    const { calls, lookup } = fakeResolver([
      { address: '8.8.8.8', family: 4 },
    ]);
    await expect(runLookup(lookup, 'attacker.example')).rejects.toMatchObject({
      code: 'EPUSHENDPOINT',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects any private result, including a mixed public/private answer', async () => {
    for (const addresses of [
      [{ address: '127.0.0.1', family: 4 as const }],
      [{ address: '169.254.169.254', family: 4 as const }],
      [{ address: '::1', family: 6 as const }],
      [
        { address: '8.8.8.8', family: 4 as const },
        { address: '10.0.0.5', family: 4 as const },
      ],
    ]) {
      const { lookup } = fakeResolver([...addresses]);
      await expect(
        runLookup(lookup, 'fcm.googleapis.com'),
      ).rejects.toMatchObject({ code: 'EPUSHENDPOINT' });
    }
  });

  it('returns the validated addresses Node will connect to', async () => {
    const addresses: LookupAddress[] = [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ];
    const { lookup } = fakeResolver(addresses);
    const all = await runLookup(lookup, 'fcm.googleapis.com', true);
    expect(all.address).toEqual(addresses);
    const one = await runLookup(lookup, 'fcm.googleapis.com', false);
    expect(one).toEqual({ address: '8.8.8.8', family: 4 });
  });

  it('propagates DNS errors without inventing an address', async () => {
    const lookup = createSafePushLookup((_hostname, _options, callback) => {
      callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
    });
    await expect(
      runLookup(lookup, 'fcm.googleapis.com'),
    ).rejects.toMatchObject({ code: 'ENOTFOUND' });
  });

  it('attaches the connection-time validator to the real HTTPS agent', () => {
    expect(
      typeof (SAFE_PUSH_AGENT.options as { lookup?: unknown }).lookup,
    ).toBe('function');
  });
});
