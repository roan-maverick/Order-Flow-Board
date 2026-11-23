import type { MarketData } from '../../src/data/types';
import { loadCrypto, type CryptoFeed } from '../../src/data/crypto';

/**
 * Keeps the crypto board fresh: picks the most-traded perpetuals, then pulls
 * the newest bars and open interest every minute, and re-picks the list every
 * half hour so it follows where the volume goes.
 */
export interface CryptoEngineOptions {
  count: number;
  refreshSeconds: number;
  exchange: 'auto' | 'binance' | 'bybit' | 'gate';
  log: (msg: string) => void;
}

export interface CryptoStatus {
  phase: 'starting' | 'loading' | 'ready' | 'error';
  source: string | null;
  lastRefresh: number | null;
  lastError: string | null;
}

const RELOAD_MS = 30 * 60_000;

export class CryptoEngine {
  private data: MarketData | null = null;
  private feed: CryptoFeed | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadedAt = 0;
  private stopped = false;
  version = 0;
  readonly status: CryptoStatus = { phase: 'starting', source: null, lastRefresh: null, lastError: null };

  constructor(private readonly opts: CryptoEngineOptions) {}

  marketData(): MarketData | null {
    return this.data;
  }

  async start(): Promise<void> {
    this.status.phase = 'loading';
    await this.reload();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async reload() {
    try {
      const started = Date.now();
      const { data, feed } = await loadCrypto(this.opts.count, this.opts.exchange);
      this.data = data;
      this.feed = feed;
      this.loadedAt = Date.now();
      this.version++;
      this.status.phase = 'ready';
      this.status.source = data.source;
      this.status.lastRefresh = Date.now();
      this.status.lastError = null;
      this.opts.log(`Crypto: ${data.assets.length} perps from ${data.source} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      this.status.lastError = this.opts.exchange === 'auto'
        ? 'none of the exchanges (Binance, Bybit, Gate.io) answered from this network. Retrying every 5 minutes'
        : `${this.opts.exchange} did not answer (${detail}). Retrying every 5 minutes`;
      if (!this.data) this.status.phase = 'error';
      this.opts.log(`Crypto: could not load (${detail})`);
    }
  }

  private schedule() {
    if (this.stopped) return;
    const wait = this.data ? this.opts.refreshSeconds * 1000 : 5 * 60_000;
    this.timer = setTimeout(async () => {
      if (!this.data || !this.feed || Date.now() - this.loadedAt > RELOAD_MS) await this.reload();
      else {
        try {
          this.data = await this.feed.refresh(this.data);
          this.version++;
          this.status.lastRefresh = Date.now();
          this.status.lastError = null;
        } catch (e) {
          this.status.lastError = e instanceof Error ? e.message : String(e);
        }
      }
      this.schedule();
    }, wait);
  }
}
