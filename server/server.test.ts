import { describe, expect, it } from 'vitest';
import { parseConstituents, parseCsv, yahooSymbol } from './us/sp500';
import { parseYahooChart } from './us/yahoo';
import { cboeSymbol, parseCboeChain } from './us/cboe';
import { assembleUs, mergeBars, type SymbolState } from './us/assemble';
import { handleApi } from './api';
import { loadConfig } from './config';
import { Store } from './store';
import { nyTime } from '../src/data/time';
import type { Candle } from '../src/data/types';

const BAR = 300_000;

describe('S&P 500 list', () => {
  it('reads quoted CSV fields and maps GICS sectors', () => {
    const csv = 'Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location\n'
      + 'AAPL,Apple Inc.,Information Technology,Hardware,"Cupertino, California"\n'
      + 'BRK.B,Berkshire Hathaway,Financials,Multi-Sector Holdings,"Omaha, Nebraska"\n'
      + 'XYZ,"Block, Inc.",Financials,Payments,"Oakland, California"\n'
      + 'BAD,Bad Row,Not A Sector,x,y\n';
    expect(parseCsv('a,"b, c",d\n')[0]).toEqual(['a', 'b, c', 'd']);
    const list = parseConstituents(csv);
    expect(list).toEqual([
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'tech' },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway', sector: 'financials' },
      { symbol: 'XYZ', name: 'Block, Inc.', sector: 'financials' },
    ]);
    expect(yahooSymbol('BRK.B')).toBe('BRK-B');
    expect(cboeSymbol('BRK.B')).toBe('BRKB');
  });
});

describe('Yahoo bars', () => {
  it('drops empty bars and folds a live tick into its 5-minute bar', () => {
    const t0 = 1_795_444_200; // 09:30 New York, seconds
    const series = parseYahooChart({
      chart: {
        result: [{
          meta: { chartPreviousClose: 100, regularMarketPrice: 102.1, regularMarketTime: t0 + 740, currentTradingPeriod: { regular: { start: t0, end: t0 + 23_400 } } },
          timestamp: [t0, t0 + 300, t0 + 600, t0 + 737],
          indicators: { quote: [{ open: [100, null, 101, 101.5], high: [101, null, 102, 103], low: [99, null, 100.5, 101], close: [100.5, null, 101.5, 102], volume: [1000, null, 800, 50] }] },
        }],
      },
    });
    expect(series.candles.map(c => c.t / 1000)).toEqual([t0, t0 + 600]);
    expect(series.candles[1]).toMatchObject({ h: 103, c: 102, v: 850 });
    expect(series.chartPreviousClose).toBe(100);
    expect(series.regular).toEqual({ start: t0 * 1000, end: (t0 + 23_400) * 1000 });
    expect(series).toMatchObject({ marketPrice: 102.1, marketTime: (t0 + 740) * 1000 });
  });
});

describe('Cboe option walls', () => {
  it('sums open interest by strike for near expiries of the standard series only', () => {
    const now = Date.UTC(2026, 10, 23, 15);
    const chain = parseCboeChain({
      data: {
        current_price: 100,
        options: [
          { option: 'AAPL261127C00105000', open_interest: 500, volume: 10 },
          { option: 'AAPL261204C00105000', open_interest: 300, volume: 5 },
          { option: 'AAPL261127P00095000', open_interest: 700, volume: 20 },
          { option: 'AAPL270115C00110000', open_interest: 9999, volume: 1 }, // beyond 35 days: volume counts, OI does not
          { option: 'AAPL1261127C00105000', open_interest: 4444, volume: 4 }, // adjusted series: skipped
        ],
      },
    }, now, 'AAPL');
    expect(chain.strikes).toEqual([[95, 0, 700], [105, 800, 0]]);
    expect(chain.callVol).toBe(16);
    expect(chain.putVol).toBe(20);
  });
});

/** Builds a stock's bars for a list of New York dates. */
function bars(dates: string[], price: (day: number, slot: number) => number, slots = 78, vol = 100): Candle[] {
  const out: Candle[] = [];
  dates.forEach((date, d) => {
    const open = nyTime(date, 9, 30);
    for (let i = 0; i < slots; i++) {
      const c = price(d, i);
      out.push({ t: open + i * BAR, o: c, h: c, l: c, c, v: vol * (d + 1) });
    }
  });
  return out;
}

describe('US session assembly', () => {
  const dates = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23'];
  const spy: SymbolState = { symbol: 'SPY', name: 'S&P 500 ETF', sector: 'etf', group: 'etf', bars: bars(dates, (d, i) => 600 + d + i * 0.01, 78) };

  it('shows the latest session, measured from the official previous close', () => {
    const today = bars(['2026-11-23'], (_, i) => 200 + i * 0.1, 30);
    const aapl: SymbolState = { symbol: 'AAPL', name: 'Apple', sector: 'tech', group: 'sp500', bars: [...bars(dates.slice(0, 4), () => 190), ...today], officialPrev: { date: '2026-11-23', close: 195 } };
    const halted: SymbolState = { symbol: 'HALT', name: 'Halted', sector: 'tech', group: 'sp500', bars: bars(dates.slice(0, 4), () => 50) };
    const now = nyTime('2026-11-23', 12, 0);
    const data = assembleUs([spy, aapl, halted], { now, benchmark: 'SPY', source: 'test' })!;
    expect(data.sessionDate).toBe('2026-11-23');
    expect(data.marketOpen).toBe(true);
    expect(data.session).toEqual({ open: nyTime('2026-11-23', 9, 30), close: nyTime('2026-11-23', 16, 0) });
    expect(data.assets.map(a => a.symbol)).toEqual(['SPY', 'AAPL']); // HALT has no bars today
    const a = data.assets[1];
    expect(a.prevClose).toBe(195);
    expect(a.candles.length).toBe(78 + 30); // previous session + today
    expect(a.avgSlotVol![0]).toBe(250); // mean of 100, 200, 300, 400
    expect(data.assets[0].prevClose).toBeCloseTo(603.77); // no official close: last bar of Friday
  });

  it('reads a closed market as the last session', () => {
    const data = assembleUs([spy], { now: nyTime('2026-11-23', 20, 0), benchmark: 'SPY', source: 'test' })!;
    expect(data.marketOpen).toBe(false);
    expect(data.asOf).toBe(nyTime('2026-11-23', 16, 0));
  });

  it('ends the day at the official closing price, not the last 5-minute bar', () => {
    const now = nyTime('2026-11-23', 20, 0);
    const withAuction: SymbolState = { ...spy, lastPrice: { t: nyTime('2026-11-23', 16, 0) + 3000, price: 607.5 } };
    const last = (d: ReturnType<typeof assembleUs>) => d!.assets[0].candles.at(-1)!;
    expect(last(assembleUs([withAuction], { now, benchmark: 'SPY', source: 'test' })).c).toBe(607.5);
    // A price from another day, or far from the bar, is ignored.
    const stale: SymbolState = { ...spy, lastPrice: { t: nyTime('2026-11-20', 16, 0), price: 607.5 } };
    expect(last(assembleUs([stale], { now, benchmark: 'SPY', source: 'test' })).c).toBeCloseTo(604.77);
  });

  it('merges fresh bars over stored ones', () => {
    const old = [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: BAR, o: 1, h: 1, l: 1, c: 1, v: 1 }];
    const merged = mergeBars(old, [{ t: BAR, o: 2, h: 2, l: 2, c: 2, v: 2 }, { t: 2 * BAR, o: 3, h: 3, l: 3, c: 3, v: 3 }]);
    expect(merged.map(c => c.c)).toEqual([1, 2, 3]);
  });
});

describe('settings', () => {
  it('uses defaults, then the file, then environment variables', () => {
    const cfg = loadConfig({ PORT: '6000', FLOW_DEMO: '1', FLOW_CRYPTO_COUNT: '500' }, '/nonexistent/flow.config.json');
    expect(cfg.port).toBe(6000);
    expect(cfg.demo).toBe(true);
    expect(cfg.crypto.count).toBe(150); // capped
    expect(cfg.us.optionsTop).toBe(100);
  });
});

describe('API', () => {
  const store = new Store({ ...loadConfig({}, '/nonexistent'), demo: true }, () => {});
  const get = (path: string, ifNoneMatch?: string) => {
    const url = new URL(path, 'http://x');
    return handleApi(url.pathname, url.searchParams, store, ifNoneMatch);
  };

  it('lists the endpoints and reports health', () => {
    expect(get('/api').status).toBe(200);
    const h = get('/api/health').body as { ok: boolean; markets: { us: { names: number; mode: string } } };
    expect(h.ok).toBe(true);
    expect(h.markets.us.mode).toBe('demo');
    expect(h.markets.us.names).toBeGreaterThan(500);
  });

  it('serves the board, filtered setups and the text brief', () => {
    const board = get('/api/flow/us').body as { counts: { total: number }; sectors: unknown[]; bullish: unknown[]; strongest: { bullish: unknown[] } };
    expect(board.counts.total).toBeGreaterThan(500);
    expect(board.sectors.length).toBeGreaterThan(10);
    const setups = get('/api/flow/us?side=bullish&minChecks=3&limit=5').body as { results: Array<{ side: string; conviction: { held: number } }> };
    expect(setups.results.length).toBeLessThanOrEqual(5);
    for (const r of setups.results) { expect(r.side).toBe('bullish'); expect(r.conviction.held).toBeGreaterThanOrEqual(3); }
    const text = get('/api/flow/crypto?format=text&window=4h');
    expect(text.text).toBe(true);
    expect(String(text.body)).toContain('CRYPTO PERPETUALS');
  });

  it('serves one name with candles, and says clearly what is wrong', () => {
    const nvda = get('/api/flow/us/nvda').body as { symbol: string; candles: unknown[] };
    expect(nvda.symbol).toBe('NVDA');
    expect(nvda.candles.length).toBeGreaterThan(10);
    expect(get('/api/flow/us/NOPE').status).toBe(404);
    expect(get('/api/flow/us?window=24h').status).toBe(400);
    expect(get('/api/flow/us?minChecks=9').status).toBe(400);
    expect(get('/api/flow/forex').status).toBe(404);
  });

  it('answers a malformed address with 400 instead of failing', () => {
    expect(get('/api/flow/us/%E0%A4%A').status).toBe(400);
  });

  it('answers 304 when the board has not changed', () => {
    const first = get('/api/market/us');
    expect(first.status).toBe(200);
    expect(get('/api/market/us', first.etag).status).toBe(304);
  });
});
