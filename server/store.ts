import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MarketData, MarketId } from '../src/data/types';
import { demoCrypto, demoUs } from '../src/data/demo';
import { buildFlow, type Flow, type WindowId } from '../src/model/flow';
import { selectUniverse, universeDef, type UniverseId } from '../src/model/universe';
import type { FlowConfig } from './config';
import { CryptoEngine } from './crypto/engine';
import { UsEngine, type UsStatus } from './us/engine';
import type { CryptoStatus } from './crypto/engine';

/**
 * Holds each market's latest data, whichever way it arrives: the live engines,
 * the simulated demo market, or a saved market file.
 */
export interface MarketSnapshot {
  data: MarketData | null;
  /** Changes whenever the data does (used for ETags). */
  version: string;
  status: MarketStatus;
}

export interface MarketStatus {
  mode: 'live' | 'demo' | 'file' | 'off';
  phase: 'starting' | 'loading' | 'ready' | 'error' | 'off';
  message: string | null;
  loaded?: number;
  total?: number;
  marketOpen?: boolean;
  sessionDate?: string | null;
  source?: string | null;
  lastRefresh?: number | null;
  nextRefresh?: number | null;
  optionsLoaded?: number;
}

const DEMO_TICK = 30_000;

export class Store {
  readonly us: UsEngine | null = null;
  readonly crypto: CryptoEngine | null = null;
  private files: Partial<Record<MarketId, MarketData>> = {};
  private flows = new Map<string, Flow>();

  constructor(private readonly cfg: FlowConfig, private readonly log: (m: string) => void = console.log) {
    if (!cfg.demo) {
      if (cfg.us.enabled && !cfg.usFile) {
        this.us = new UsEngine({
          refreshMinutes: cfg.us.refreshMinutes,
          popular: cfg.us.popular,
          cacheFile: resolve(cfg.cacheDir, 'us-session.json'),
          concurrency: cfg.us.concurrency,
          optionsConcurrency: 2,
          optionsHours: cfg.us.optionWalls ? cfg.us.optionsHours : 0,
          optionsTop: cfg.us.optionsTop,
          log,
        });
      }
      if (cfg.crypto.enabled && !cfg.cryptoFile) {
        this.crypto = new CryptoEngine({ count: cfg.crypto.count, refreshSeconds: cfg.crypto.refreshSeconds, exchange: cfg.crypto.exchange, log });
      }
    }
    for (const [market, file] of [['us', cfg.usFile], ['crypto', cfg.cryptoFile]] as const) {
      if (file) this.files[market] = JSON.parse(readFileSync(file, 'utf8')) as MarketData;
    }
  }

  async start() {
    await Promise.all([this.us?.start(), this.crypto?.start().catch(e => this.log(`Crypto: ${e}`))]);
  }

  stop() {
    this.us?.stop();
    this.crypto?.stop();
  }

  snapshot(market: MarketId, now = Date.now()): MarketSnapshot {
    if (market === 'us' ? !this.cfg.us.enabled : !this.cfg.crypto.enabled) {
      return { data: null, version: 'off', status: { mode: 'off', phase: 'off', message: `the ${market === 'us' ? 'US' : 'crypto'} board is turned off in the settings` } };
    }
    const file = this.files[market];
    if (file) return { data: file, version: 'file', status: { mode: 'file', phase: 'ready', message: null, source: file.source, marketOpen: file.marketOpen, sessionDate: file.sessionDate } };
    if (this.cfg.demo) {
      const tick = Math.floor(now / DEMO_TICK) * DEMO_TICK;
      const data = market === 'us' ? demoUs(tick) : demoCrypto(tick, 60);
      return { data, version: `demo-${tick}`, status: { mode: 'demo', phase: 'ready', message: 'demo mode (simulated prices)', source: data.source, marketOpen: data.marketOpen } };
    }
    if (market === 'us' && this.us) {
      // During the very first load (no saved session yet) the board waits for the whole list.
      const firstLoad = this.us.status.phase === 'loading' && !this.us.status.fromCache;
      const data = firstLoad ? null : this.us.marketData(now);
      return { data, version: `us-${this.us.version}`, status: usStatus(this.us.status, data) };
    }
    if (market === 'crypto' && this.crypto) {
      const data = this.crypto.marketData();
      return { data, version: `crypto-${this.crypto.version}`, status: cryptoStatus(this.crypto.status) };
    }
    return { data: null, version: 'none', status: { mode: 'off', phase: 'off', message: 'no source' } };
  }

  /** The computed board for a market, window and universe (cached per data version). */
  flow(market: MarketId, windowId: WindowId, universe: UniverseId): { flow: Flow; snapshot: MarketSnapshot } | null {
    const snapshot = this.snapshot(market);
    if (!snapshot.data) return null;
    const key = `${market}|${snapshot.version}|${windowId}|${universe}`;
    let flow = this.flows.get(key);
    if (!flow) {
      flow = buildFlow(snapshot.data, windowId, { symbols: selectUniverse(snapshot.data, universeDef(market, universe).id) });
      if (this.flows.size > 40) this.flows.clear();
      this.flows.set(key, flow);
    }
    return { flow, snapshot };
  }
}

function usStatus(s: UsStatus, data: MarketData | null): MarketStatus {
  const message = s.phase === 'loading' ? `loading the S&P 500: ${s.loaded} of ${s.total} names` : s.phase === 'error' ? s.lastError : null;
  return {
    mode: 'live', phase: s.phase, message, loaded: s.loaded, total: s.total, marketOpen: data?.marketOpen ?? s.marketOpen,
    sessionDate: data?.sessionDate ?? s.sessionDate, source: data?.source ?? null, lastRefresh: s.lastRefresh, nextRefresh: s.nextRefresh, optionsLoaded: s.optionsLoaded,
  };
}

function cryptoStatus(s: CryptoStatus): MarketStatus {
  return { mode: 'live', phase: s.phase, message: s.phase === 'error' ? s.lastError : s.phase === 'loading' ? 'loading the most-traded perpetuals' : null, source: s.source, lastRefresh: s.lastRefresh };
}
