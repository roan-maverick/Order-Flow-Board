import { describe, expect, it } from 'vitest';
import { buildFlow, optionLevels, sliceWindow, volumeLevels } from './flow';
import { demoCrypto, demoUs } from '../data/demo';
import { deribitStrikes, parseDeribit, parseSymbol, pickUniverse } from '../data/crypto';
import type { AssetSeries, Candle, MarketData } from '../data/types';

const NOW = Date.parse('2026-11-06T18:45:00Z'); // a Friday, US session open

const bar = (t: number, c: number, v = 100, tb?: number): Candle => ({ t, o: c, h: c, l: c, c, v, tb });

function cryptoFile(assets: AssetSeries[], asOf: number): MarketData {
  return { market: 'crypto', source: 'test', live: true, asOf, benchmark: 'BTC', assets };
}

describe('build-up and sides (crypto)', () => {
  const asOf = 1_000 * 5 * 60_000;
  const t0 = asOf - 300 * 5 * 60_000;
  const series = (symbol: string, from: number, to: number, oiFrom: number, oiTo: number, sector = 'l1'): AssetSeries => {
    const candles = Array.from({ length: 300 }, (_, i) => bar(t0 + i * 300_000, from + ((to - from) * i) / 299, 100, 60));
    const oi = candles.map((c, i) => ({ t: c.t, oi: oiFrom + ((oiTo - oiFrom) * i) / 299 }));
    return { symbol, name: symbol, sector, candles, oi };
  };

  it('reads the four quadrants from price and open interest', () => {
    const flow = buildFlow(cryptoFile([
      series('BTC', 100, 103, 1000, 1100, 'majors'),
      series('UPUP', 100, 105, 1000, 1200),
      series('UPDN', 100, 105, 1000, 900),
      series('DNUP', 100, 95, 1000, 1200),
      series('DNDN', 100, 95, 1000, 900),
      series('FLAT', 100, 100.2, 1000, 1000),
    ], asOf), '24h');
    const by = Object.fromEntries(flow.assets.map(a => [a.symbol, a]));
    expect(by.UPUP.buildUp.code).toBe('LONG_BUILD');
    expect(by.UPDN.buildUp.code).toBe('SHORT_COVER');
    expect(by.DNUP.buildUp.code).toBe('SHORT_BUILD');
    expect(by.DNDN.buildUp.code).toBe('LONG_UNWIND');
    expect(by.FLAT.side).toBe('rangebound');
    expect(flow.bullish.map(a => a.symbol)).toContain('UPUP');
    expect(flow.bearish.map(a => a.symbol)).toEqual(expect.arrayContaining(['DNUP', 'DNDN']));
    // a long build-up with buyers leading and BTC agreeing holds most checks
    expect(by.UPUP.checks.find(c => c.id === 'fresh')?.pass).toBe(true);
    expect(by.UPUP.checks.find(c => c.id === 'flow')?.pass).toBe(true);
    expect(by.UPUP.checks.find(c => c.id === 'market')?.pass).toBe(true);
    expect(by.DNUP.checks.find(c => c.id === 'market')?.pass).toBe(false);
  });

  it('ranks each side by the size of the move', () => {
    const flow = buildFlow(cryptoFile([
      series('BTC', 100, 101.5, 1000, 1010, 'majors'),
      series('A', 100, 102, 1000, 1010),
      series('B', 100, 108, 1000, 1010),
      series('C', 100, 104, 1000, 1010),
    ], asOf), '24h');
    expect(flow.bullish.map(a => a.symbol)).toEqual(['B', 'C', 'A', 'BTC']);
    expect(flow.bullish[0].rank).toBe(1);
  });
});

describe('windows', () => {
  it('measures the US day from the previous close', () => {
    const open = Date.parse('2026-11-06T14:30:00Z');
    const s: AssetSeries = { symbol: 'X', name: 'X', sector: 'tech', prevClose: 100, candles: [bar(open - 86400_000, 99), bar(open, 102), bar(open + 300_000, 103)] };
    const slice = sliceWindow(s, open, open + 600_000, true)!;
    expect(slice.base).toBe(100);
    expect(slice.points.at(-1)!.pct).toBeCloseTo(3);
  });
});

describe('levels', () => {
  it('takes the heaviest puts below spot and calls above', () => {
    const { support, resistance } = optionLevels([[90, 10, 500], [95, 50, 900], [100, 300, 300], [105, 1200, 20], [110, 800, 0]], 101);
    expect(support?.price).toBe(95);
    expect(resistance?.price).toBe(105);
  });

  it('finds volume shelves either side of spot', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) candles.push({ t: i, o: 90, h: 91, l: 89, c: 90, v: 1000 });
    for (let i = 0; i < 20; i++) candles.push({ t: 100 + i, o: 100, h: 101, l: 99, c: 100, v: 10 });
    for (let i = 0; i < 40; i++) candles.push({ t: 200 + i, o: 110, h: 111, l: 109, c: 110, v: 500 });
    const { support, resistance } = volumeLevels(candles, 100);
    expect(support!.price).toBeGreaterThan(88);
    expect(support!.price).toBeLessThan(92);
    expect(resistance!.price).toBeGreaterThan(108);
  });
});

describe('venue parsing', () => {
  it('unwraps 1000x contracts and skips stablecoins', () => {
    expect(parseSymbol('1000PEPEUSDT')).toEqual({ base: 'PEPE', mult: 1000 });
    expect(parseSymbol('BTCUSDT')).toEqual({ base: 'BTC', mult: 1 });
    expect(parseSymbol('USDCUSDT')).toBeNull();
    expect(parseSymbol('ETHBTC')).toBeNull();
  });

  it('picks the most traded perps and always keeps BTC and ETH', () => {
    const picked = pickUniverse([
      { venue: 'SOLUSDT', turnover: 9e9 }, { venue: 'DOGEUSDT', turnover: 8e9 }, { venue: 'BTCUSDT', turnover: 1 },
      { venue: 'ETHUSDT', turnover: 2 }, { venue: 'USDCUSDT', turnover: 9e12 },
    ], 3);
    expect(picked.map(p => p.base)).toEqual(['BTC', 'ETH', 'SOL']);
  });

  it('reads Deribit instrument names and sums OI by strike', () => {
    expect(parseDeribit('BTC-27NOV26-100000-C')).toEqual({ expiry: Date.UTC(2026, 10, 27, 8), strike: 100000, side: 'C' });
    const book = deribitStrikes([
      { instrument_name: 'BTC-27NOV26-100000-C', open_interest: 10, volume: 1 },
      { instrument_name: 'BTC-20NOV26-100000-C', open_interest: 5, volume: 2 },
      { instrument_name: 'BTC-27NOV26-90000-P', open_interest: 7, volume: 3 },
      { instrument_name: 'BTC-26MAR27-90000-P', open_interest: 99, volume: 3 },
    ], NOW);
    expect(book.strikes).toEqual([[90000, 0, 7], [100000, 15, 0]]);
  });
});

describe('demo markets', () => {
  it('builds a full crypto board that splits both ways', () => {
    const flow = buildFlow(demoCrypto(NOW), '24h');
    expect(flow.assets.length).toBe(60);
    expect(flow.benchmark?.symbol).toBe('BTC');
    expect(flow.bullish.length + flow.bearish.length).toBeGreaterThan(20);
    expect(flow.featured.bullish.length + flow.featured.bearish.length).toBeGreaterThan(0);
    expect(flow.sectors.length).toBeGreaterThan(5);
    expect(flow.assets.find(a => a.symbol === 'BTC')?.support?.kind).toBe('options');
  });

  it('is deterministic for the same moment', () => {
    const a = buildFlow(demoCrypto(NOW), '4h').assets.map(x => x.changePct);
    const b = buildFlow(demoCrypto(NOW), '4h').assets.map(x => x.changePct);
    expect(a).toEqual(b);
  });

  it('builds a US session with relative volume and option walls', () => {
    const data = demoUs(NOW);
    const flow = buildFlow(data, 'day');
    expect(flow.assets.length).toBe(70);
    const nvda = flow.assets.find(a => a.symbol === 'NVDA')!;
    expect(nvda.rvol).not.toBeNull();
    expect(nvda.support?.kind).toBe('options');
    expect(['ACCUMULATION', 'DRIFT_UP', 'DISTRIBUTION', 'DRIFT_DOWN', 'NEUTRAL']).toContain(nvda.buildUp.code);
    for (const w of ['1h', '15m'] as const) expect(buildFlow(data, w).assets.length).toBe(70);
  });
});
