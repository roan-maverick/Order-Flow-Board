/**
 * One place for outbound requests: a timeout, a polite user agent, and
 * retries with back-off when a provider says "slow down" (429) or hiccups (5xx).
 */
export const USER_AGENT = 'Mozilla/5.0 (compatible; GlobalOrderFlow/2.0; +https://github.com/roan-maverick/order-flow-open)';

export interface RequestStats {
  requests: number;
  ok: number;
  throttled: number; // 429 answers seen (including ones that later succeeded)
  failed: number;
  bytes: number;
}

export const newStats = (): RequestStats => ({ requests: 0, ok: 0, throttled: 0, failed: 0, bytes: 0 });

export class HttpError extends Error {
  constructor(readonly status: number, readonly url: string) {
    super(`${status} from ${new URL(url).host}`);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface GetOptions {
  timeoutMs?: number;
  retries?: number;
  stats?: RequestStats;
  headers?: Record<string, string>;
}

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, retries = 2, stats, headers } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (stats) stats.requests++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, accept: 'application/json,text/plain,*/*', ...headers } });
      if (res.status === 429 || res.status >= 500) {
        if (res.status === 429 && stats) stats.throttled++;
        lastError = new HttpError(res.status, url);
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1200 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      const text = await res.text();
      if (stats) { stats.ok++; stats.bytes += text.length; }
      return text;
    } catch (e) {
      lastError = e;
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) break; // 4xx other than 429: do not retry
      if (attempt < retries) await sleep(800 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  if (stats) stats.failed++;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson<T>(url: string, opts: GetOptions = {}): Promise<T> {
  return JSON.parse(await getText(url, opts)) as T;
}

/** Runs tasks with at most `limit` in flight, in order of the list. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
