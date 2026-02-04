const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

