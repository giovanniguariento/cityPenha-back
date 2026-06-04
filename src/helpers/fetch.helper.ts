import { logger, LOG_SLOW_MS } from '../lib/logger';

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const safeUrl = sanitizeUrl(url);
  const start = Date.now();

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const durationMs = Date.now() - start;

    if (!res.ok) {
      logger.error({ url: safeUrl, status: res.status, durationMs }, 'fetch failed');
    } else if (durationMs > LOG_SLOW_MS) {
      logger.warn(
        { url: safeUrl, durationMs, thresholdMs: LOG_SLOW_MS },
        'slow fetch'
      );
    } else {
      logger.debug({ url: safeUrl, status: res.status, durationMs }, 'fetch ok');
    }

    return res;
  } catch (err) {
    const durationMs = Date.now() - start;
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn({ url: safeUrl, durationMs, timeoutMs }, 'fetch timeout');
    } else {
      logger.error({ url: safeUrl, durationMs, err }, 'fetch error');
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}
