/**
 * Validates that a URL is safe to fetch server-side (SSRF mitigation).
 * - Only http/https
 * - Blocks localhost, private, link-local, and cloud metadata IPs
 * - Optional hostname allowlist via EXTERNAL_FETCH_ALLOWED_HOSTS (CSV)
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

function parseAllowlist(): string[] | null {
  const raw = process.env.EXTERNAL_FETCH_ALLOWED_HOSTS?.trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function isPrivateOrReservedIpv4(hostname: string): boolean {
  const n = ipv4ToInt(hostname);
  if (n === null) return false;

  // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12,
  // 192.168.0.0/16, 100.64.0.0/10 (CGNAT), 192.0.0.0/24, 192.0.2.0/24,
  // 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4
  const ranges: Array<[number, number]> = [
    [ipv4ToInt('0.0.0.0')!, ipv4ToInt('0.255.255.255')!],
    [ipv4ToInt('10.0.0.0')!, ipv4ToInt('10.255.255.255')!],
    [ipv4ToInt('100.64.0.0')!, ipv4ToInt('100.127.255.255')!],
    [ipv4ToInt('127.0.0.0')!, ipv4ToInt('127.255.255.255')!],
    [ipv4ToInt('169.254.0.0')!, ipv4ToInt('169.254.255.255')!],
    [ipv4ToInt('172.16.0.0')!, ipv4ToInt('172.31.255.255')!],
    [ipv4ToInt('192.0.0.0')!, ipv4ToInt('192.0.0.255')!],
    [ipv4ToInt('192.0.2.0')!, ipv4ToInt('192.0.2.255')!],
    [ipv4ToInt('192.168.0.0')!, ipv4ToInt('192.168.255.255')!],
    [ipv4ToInt('198.51.100.0')!, ipv4ToInt('198.51.100.255')!],
    [ipv4ToInt('203.0.113.0')!, ipv4ToInt('203.0.113.255')!],
    [ipv4ToInt('224.0.0.0')!, ipv4ToInt('255.255.255.255')!],
  ];

  return ranges.some(([start, end]) => n >= start && n <= end);
}

function isBlockedIpv6(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  // Unique local fc00::/7, link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true;
  }
  // IPv4-mapped
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1] && isPrivateOrReservedIpv4(mapped[1])) return true;
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Returns a parsed URL if safe to fetch; throws UnsafeUrlError otherwise.
 */
export function assertSafeExternalUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError('Only http/https URLs are allowed');
  }

  // Prefer https for external fetches in production
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only https URLs are allowed in production');
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError('Hostname is not allowed');
  }

  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('Hostname is not allowed');
  }

  if (isPrivateOrReservedIpv4(hostname) || isBlockedIpv6(hostname)) {
    throw new UnsafeUrlError('Private or reserved IP addresses are not allowed');
  }

  const allowlist = parseAllowlist();
  if (allowlist && allowlist.length > 0) {
    const allowed = allowlist.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
    if (!allowed) {
      throw new UnsafeUrlError('Hostname is not in the allowlist');
    }
  }

  return url;
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    assertSafeExternalUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
