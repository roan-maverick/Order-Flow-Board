import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MarketData } from '../../src/data/types';
import { US_ETFS } from '../../src/data/sectors';
import bundled from '../../src/data/sp500.json';
import { getText, newStats, pool, type RequestStats } from '../http';
import { assembleUs, mergeBars, sessions, type SymbolState } from './assemble';
import { fetchCboe } from './cboe';
import { parseConstituents, SP500_CSV_URL, type Constituent } from './sp500';
import { fetchYahoo } from './yahoo';

/**
 * Keeps the US board fresh.
 *
 *  - On start: reads the S&P 500 list, shows the last saved session from disk
 *    straight away (if any), then loads about a week of 5-minute bars for
 *    every name.
 *  - While the market is open: pulls today's bars for every name every few
 *    minutes. If Yahoo starts saying "slow down", it waits longer between rounds.
 *  - While it is closed: one last round after the close, then a cheap check
 *    every 30 minutes for the next session.
 *  - In the background: option chains (put and call walls), busiest names
 *    first, about once a day each.
 */

export interface UsEngineOptions {
  /** Minutes between refresh rounds while the market is open. */
  refreshMinutes: number;
  /** Popular names outside the S&P 500 to add: [symbol, name]. */
  popular: Array<[string, string]>;
  /** Where to save the last session and the S&P 500 list. Null: no disk cache. */
  cacheFile: string | null;
  concurrency: number;
  optionsConcurrency: number;
  /** Hours an option chain stays fresh. 0 turns option walls off. */
  optionsHours: number;
  /** Option walls for the busiest N names (chains are large: SPY's is about 6 MB). */
  optionsTop: number;
  /** Load only the first N names (for quick tests). */
  limit?: number;
  log: (msg: string) => void;
}

export type Phase = 'starting' | 'loading' | 'ready' | 'error';

export interface UsStatus {
  phase: Phase;
  loaded: number;
  total: number;
  marketOpen: boolean;
  sessionDate: string | null;
  lastRefresh: number | null;
  nextRefresh: number | null;
  refreshMinutes: number;
  optionsLoaded: number;
  fromCache: boolean;
  members: number;
  membersSource: 'online' | 'bundled';
  lastError: string | null;
  stats: RequestStats;
}

const MIN = 60_000;
const CLOSED_CHECK_MIN = 30;
const RETRY_MIN = 5;
const BENCHMARK = 'SPY';

export class UsEngine {
  private states = new Map<string, SymbolState>();
  private order: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private optionsTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private busy = false;
  private cached: { version: number; data: MarketData | null } = { version: -1, data: null };
  private interval: number;
  version = 0;
  readonly status: UsStatus;

  constructor(private readonly opts: UsEngineOptions) {
    this.interval = opts.refreshMinutes;
    this.status = {
      phase: 'starting', loaded: 0, total: 0, marketOpen: false, sessionDate: null, lastRefresh: null, nextRefresh: null,
      refreshMinutes: opts.refreshMinutes, optionsLoaded: 0, fromCache: false, members: 0, membersSource: 'bundled', lastError: null, stats: newStats(),
    };
  }

  /** The board's market file, rebuilt only when something changed. */
  marketData(now = Date.now()): MarketData | null {
    if (this.cached.version === this.version && this.cached.data) return this.cached.data;
    const data = assembleUs(this.order.map(s => this.states.get(s)!).filter(Boolean), {
      now,
      benchmark: BENCHMARK,
      source: 'US stocks',
      note: 'Yahoo Finance 5-min bars · Cboe options',
    });
    if (data) {
      this.status.marketOpen = !!data.marketOpen;
      this.status.sessionDate = data.sessionDate ?? null;
    }
    this.cached = { version: this.version, data };
    return data;
  }

  async start(): Promise<void> {
    await this.init();
    void this.firstLoad();
  }

  /** Reads the S&P 500 list and the saved session, without fetching prices. */
  async init(): Promise<void> {
    const members = await this.loadMembers();
    for (const [symbol, name] of US_ETFS) this.add({ symbol, name, sector: 'etf' }, 'etf');
    for (const m of members) this.add(m, 'sp500');
    for (const [symbol, name] of this.opts.popular) this.add({ symbol, name, sector: 'popular' }, 'popular');
    if (this.opts.limit) this.order = this.order.slice(0, this.opts.limit);
    this.status.total = this.order.length;
    this.status.members = members.length;

    await this.loadCache();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.optionsTimer) clearTimeout(this.optionsTimer);
  }

  private add(c: Constituent, group: SymbolState['group']) {
    if (this.states.has(c.symbol)) return;
    this.states.set(c.symbol, { symbol: c.symbol, name: c.name, sector: c.sector, group, bars: [] });
    this.order.push(c.symbol);
  }

  private async loadMembers(): Promise<Constituent[]> {
    try {
      const list = parseConstituents(await getText(SP500_CSV_URL, { timeoutMs: 10_000, retries: 1 }));
      if (list.length >= 480) {
        this.status.membersSource = 'online';
        return list;
      }
    } catch (e) {
      this.opts.log(`S&P 500 list: using the bundled copy (${e instanceof Error ? e.message : e})`);
    }
    return (bundled.members as Array<[string, string, string]>).map(([symbol, name, sector]) => ({ symbol, name, sector }));
  }

  private async firstLoad() {
    this.status.phase = this.status.fromCache ? 'ready' : 'loading';
    await this.refresh('5d');
    if (this.stopped) return;
    this.status.phase = this.marketData() ? 'ready' : 'error';
    if (this.status.phase === 'error') this.status.lastError = this.status.lastError ?? 'no US data could be loaded';
    void this.optionsLoop();
    this.schedule();
  }

  /** One pass over every name. 5d on the first load (history for relative volume), 1d after. */
  async refresh(range: '1d' | '5d', only?: string[]): Promise<RequestStats> {
    if (this.busy) return newStats();
    this.busy = true;
    const symbols = only ?? this.order;
    const stats = newStats();
    const started = Date.now();
    let loaded = 0;
    let lastError: string | null = null;
    let failStreak = 0;
    let unreachable = false;
    try {
      await pool(symbols, this.opts.concurrency, async symbol => {
        if (this.stopped || unreachable) return;
        const state = this.states.get(symbol)!;
        try {
          const y = await fetchYahoo(symbol, range, stats);
          if (y.candles.length) {
            state.bars = mergeBars(state.bars, y.candles);
            const latestDate = sessions(y.candles).at(-1)?.date;
            // With range=1d, chartPreviousClose is the official close before today's session.
            if (range === '1d' && y.chartPreviousClose && latestDate) state.officialPrev = { date: latestDate, close: y.chartPreviousClose };
            if (y.regular) state.regular = y.regular;
            state.error = undefined;
          }
          failStreak = 0;
        } catch (e) {
          state.error = e instanceof Error ? e.message : String(e);
          lastError = `${symbol}: ${state.error}`;
          // Nothing answering at all: stop early instead of trying 500 names one by one.
          if (++failStreak >= 12 && stats.ok === 0) unreachable = true;
        }
        loaded++;
        if (!only) this.status.loaded = Math.max(this.status.loaded, loaded);
        if (loaded % 50 === 0) this.version++;
      });
    } finally {
      this.busy = false;
    }
    this.version++;
    if (!unreachable) this.status.lastRefresh = Date.now();
    this.status.lastError = unreachable
      ? `Yahoo Finance is not answering from this network (${(lastError as string | null)?.split(': ').slice(1).join(': ') || 'no reply'}). Retrying every ${RETRY_MIN} minutes.`
      : lastError;
    for (const k of Object.keys(stats) as Array<keyof RequestStats>) this.status.stats[k] += stats[k];
    // Back off when Yahoo throttles; drift back to the normal pace when it doesn't.
    const throttledShare = stats.requests ? stats.throttled / stats.requests : 0;
    if (throttledShare > 0.02) this.interval = Math.min(60, this.interval * 2);
    else this.interval = Math.max(this.opts.refreshMinutes, Math.round(this.interval / 1.5));
    this.status.refreshMinutes = this.interval;
    if (unreachable) this.opts.log(`US: ${this.status.lastError}`);
    else this.opts.log(`US ${range} round: ${symbols.length} names in ${((Date.now() - started) / 1000).toFixed(0)}s · ${stats.ok} ok · ${stats.throttled} throttled · ${stats.failed} failed`);
    this.marketData();
    void this.saveCache();
    return stats;
  }

  private schedule() {
    if (this.stopped) return;
    const now = Date.now();
    const data = this.marketData(now);
    let wait: number;
    let next: () => Promise<void>;
    if (!data) {
      // Nothing loaded yet (offline, or the source refused): try the full load again soon.
      wait = RETRY_MIN * MIN;
      next = async () => {
        this.status.phase = this.status.phase === 'error' ? 'error' : 'loading';
        await this.refresh('5d');
        if (this.marketData()) { this.status.phase = 'ready'; this.status.lastError = null; }
      };
    } else if (data.marketOpen) {
      wait = this.interval * MIN;
      next = async () => { await this.refresh('1d'); };
    } else if (data.session && now >= data.session.close && now < data.session.close + 25 * MIN) {
      wait = Math.max(MIN, data.session.close + 20 * MIN - now); // one last round once the closing bars settle
      next = async () => { await this.refresh('1d'); };
    } else {
      wait = CLOSED_CHECK_MIN * MIN;
      next = async () => {
        // Cheap check: has a new session started for the benchmark?
        const before = this.status.sessionDate;
        await this.refresh('1d', [BENCHMARK]);
        if (this.marketData()?.sessionDate !== before) await this.refresh('5d');
      };
    }
    this.status.nextRefresh = now + wait;
    this.timer = setTimeout(async () => {
      try { await next(); } catch (e) { this.status.lastError = String(e); }
      this.schedule();
    }, wait);
  }

  private async optionsLoop() {
    if (this.stopped || this.opts.optionsHours <= 0) return;
    await this.refreshOptions();
    this.optionsTimer = setTimeout(() => void this.optionsLoop(), 30 * MIN);
  }

  /** Fetches option chains that are missing or stale, busiest names first. */
  async refreshOptions(max = Infinity): Promise<RequestStats> {
    const stats = newStats();
    const now = Date.now();
    const ttl = this.opts.optionsHours * 60 * MIN;
    const value = new Map([...this.states.values()].map(s => [s.symbol, dollarVolume(s)]));
    const due = [...this.states.values()]
      .filter(s => s.bars.length)
      .sort((a, b) => value.get(b.symbol)! - value.get(a.symbol)!)
      .slice(0, this.opts.optionsTop)
      .filter(s => !s.options || now - s.options.fetchedAt > ttl)
      .slice(0, max)
      .map(s => s.symbol);
    if (!due.length) return stats;
    await pool(due, this.opts.optionsConcurrency, async symbol => {
      if (this.stopped) return;
      const state = this.states.get(symbol)!;
      try {
        const book = await fetchCboe(symbol, Date.now(), stats);
        state.options = { callVol: book.callVol, putVol: book.putVol, strikes: book.strikes, fetchedAt: Date.now() };
      } catch {
        state.options = { callVol: null, putVol: null, strikes: [], fetchedAt: Date.now() }; // no listed options: don't retry until the TTL
      }
      this.status.optionsLoaded = [...this.states.values()].filter(s => s.options?.strikes.length).length;
      if (this.status.optionsLoaded % 25 === 0) this.version++;
    });
    this.version++;
    this.opts.log(`US options: ${due.length} chains · ${stats.ok} ok · ${stats.failed} failed · ${(stats.bytes / 1e6).toFixed(0)} MB`);
    void this.saveCache();
    return stats;
  }

  /** Everything collected so far, for tests and tools. */
  snapshot(): SymbolState[] {
    return this.order.map(s => this.states.get(s)!);
  }

  private async loadCache() {
    if (!this.opts.cacheFile) return;
    try {
      const saved = JSON.parse(await readFile(this.opts.cacheFile, 'utf8')) as { savedAt: number; states: SymbolState[] };
      if (Date.now() - saved.savedAt > 7 * 86_400_000) return;
      let n = 0;
      for (const s of saved.states) {
        const state = this.states.get(s.symbol);
        if (!state) continue;
        state.bars = s.bars;
        state.officialPrev = s.officialPrev;
        state.regular = s.regular;
        state.options = s.options;
        n++;
      }
      if (n) {
        this.version++;
        this.status.fromCache = !!this.marketData();
        this.opts.log(`US: showing the saved session (${n} names) while fresh data loads`);
      }
    } catch {
      /* no cache yet */
    }
  }

  private async saveCache() {
    if (!this.opts.cacheFile) return;
    try {
      await mkdir(dirname(this.opts.cacheFile), { recursive: true });
      const states = [...this.states.values()].filter(s => s.bars.length);
      await writeFile(this.opts.cacheFile, JSON.stringify({ savedAt: Date.now(), states }));
    } catch (e) {
      this.opts.log(`US: could not save the cache (${e instanceof Error ? e.message : e})`);
    }
  }
}

/** Today's traded value, to rank names by activity. */
export function dollarVolume(s: { bars: Array<{ c: number; v: number; t: number }> }): number {
  const last = sessions(s.bars as never).at(-1);
  return last ? last.bars.reduce((sum, c) => sum + c.c * c.v, 0) : 0;
}
