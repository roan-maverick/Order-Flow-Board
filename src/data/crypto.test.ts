import { afterEach, describe, expect, it, vi } from 'vitest';
import { binanceFeed, loadCrypto } from './crypto';
import { buildFlow } from '../model/flow';

const NOW = Date.parse('2026-11-08T10:00:00Z');
const BAR = 300_000;
const ALTS = ['SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'SUI', 'TON', 'DOT', 'NEAR', 'APT', 'LTC'];

/** Responses shaped like the venues' documented public endpoints. */
function binanceRoutes(blocked = false) {
  return (url: string) => {
    const u = new URL(url);
    if (u.host === 'fapi.binance.com' && blocked) return new Response('{"code":0,"msg":"Service unavailable from a restricted location"}', { status: 451 });
    if (u.pathname === '/fapi/v1/ticker/24hr') {
      return Response.json([
        { symbol: 'BTCUSDT', quoteVolume: '9000000000', lastPrice: '104000' },
        { symbol: 'ETHUSDT', quoteVolume: '7000000000', lastPrice: '3600' },
        { symbol: '1000PEPEUSDT', quoteVolume: '900000000', lastPrice: '0.0078' },
        { symbol: 'USDCUSDT', quoteVolume: '99999999999', lastPrice: '1' },
        ...ALTS.map((a, i) => ({ symbol: `${a}USDT`, quoteVolume: String(1e8 - i), lastPrice: '1' })),
        { symbol: 'XAUUSDT', quoteVolume: '99999999999', lastPrice: '4000' }, // tokenised gold: not a coin
      ]);
    }
    if (u.pathname === '/fapi/v1/premiumIndex') return Response.json([{ symbol: 'BTCUSDT', lastFundingRate: '0.00010000' }]);
    if (u.pathname === '/fapi/v1/klines') {
      const sym = u.searchParams.get('symbol')!;
      const n = Number(u.searchParams.get('limit'));
      const p0 = sym === 'BTCUSDT' ? 100000 : sym === '1000PEPEUSDT' ? 0.0075 : 1;
      const up = sym === 'XRPUSDT' ? -1 : 1;
      return Response.json(Array.from({ length: n }, (_, i) => {
        const t = NOW - (n - i) * BAR;
        const c = p0 * (1 + up * 0.0001 * i);
        return [t, String(c), String(c * 1.001), String(c * 0.999), String(c), '100', t + BAR - 1, String(100 * c), 10, '60', String(60 * c), '0'];
      }));
    }
    if (u.pathname === '/futures/data/openInterestHist') {
      const n = Number(u.searchParams.get('limit'));
      return Response.json(Array.from({ length: n }, (_, i) => ({ symbol: u.searchParams.get('symbol'), sumOpenInterest: String(1000 + i), sumOpenInterestValue: String((1000 + i) * 100), timestamp: NOW - (n - i) * BAR })));
    }
    if (u.host === 'www.deribit.com') {
      return Response.json({ result: [
        { instrument_name: 'BTC-27NOV26-110000-C', open_interest: 900, volume: 10 },
        { instrument_name: 'BTC-27NOV26-95000-P', open_interest: 700, volume: 8 },
      ] });
    }
    if (u.host === 'api.bybit.com') {
      if (u.pathname === '/v5/market/tickers') {
        return Response.json({ retCode: 0, retMsg: 'OK', result: { list: [
          { symbol: 'BTCUSDT', turnover24h: '9e9', fundingRate: '0.0001', openInterestValue: '7e9' },
          { symbol: 'ETHUSDT', turnover24h: '7e9', fundingRate: '0.0001', openInterestValue: '4e9' },
          ...ALTS.map((a, i) => ({ symbol: `${a}USDT`, turnover24h: String(1e8 - i), fundingRate: '0', openInterestValue: '1e6' })),
        ] } });
      }
      if (u.pathname === '/v5/market/kline') {
        const n = Number(u.searchParams.get('limit'));
        return Response.json({ retCode: 0, retMsg: 'OK', result: { list: Array.from({ length: n }, (_, i) => {
          const t = NOW - (i + 1) * BAR; // newest first
          const c = 1 + 0.0001 * (n - i);
          return [String(t), String(c), String(c), String(c), String(c), '100', String(100 * c)];
        }) } });
      }
      if (u.pathname === '/v5/market/open-interest') {
        const n = Number(u.searchParams.get('limit'));
        const cursor = u.searchParams.get('cursor');
        const offset = cursor ? 200 : 0;
        return Response.json({ retCode: 0, retMsg: 'OK', result: { nextPageCursor: cursor ? '' : 'page2', list: Array.from({ length: n }, (_, i) => ({ openInterest: String(5000 - offset - i), timestamp: String(NOW - (offset + i + 1) * BAR) })) } });
      }
    }
    if (u.host === 'api.gateio.ws') {
      if (u.pathname.endsWith('/tickers')) {
        return Response.json([
          { contract: 'BTC_USDT', last: '104000', volume_24h_quote: '9000000000', funding_rate: '0.0001' },
          { contract: 'ETH_USDT', last: '3600', volume_24h_quote: '7000000000', funding_rate: '0.0001' },
          { contract: 'NVDA_USDT', last: '180', volume_24h_quote: '8000000000', funding_rate: '0' }, // tokenised stock: not a coin
          ...ALTS.map((a, i) => ({ contract: `${a}_USDT`, last: '1', volume_24h_quote: String(1e8 - i), funding_rate: '0' })),
        ]);
      }
      if (u.pathname.endsWith('/candlesticks')) {
        const n = Number(u.searchParams.get('limit'));
        return Response.json(Array.from({ length: n }, (_, i) => {
          const t = (NOW - (n - i) * BAR) / 1000;
          const c = 1 + 0.0001 * i;
          return { t, o: String(c), h: String(c), l: String(c), c: String(c), v: 1000, sum: String(100 * c) };
        }));
      }
      if (u.pathname.endsWith('/contract_stats')) {
        const from = Number(u.searchParams.get('from'));
        const limit = Number(u.searchParams.get('limit'));
        const rows = [];
        for (let t = Math.ceil(from / 300) * 300, k = 0; t * 1000 <= NOW && k < limit; t += 300, k++) {
          rows.push({ time: t, open_interest: 5000 + k, open_interest_usd: (5000 + k) * 10, long_taker_size: 60, short_taker_size: 40 });
        }
        return Response.json(rows);
      }
    }
    return new Response('not found', { status: 404 });
  };
}

function mockFetch(route: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => route(String(input))));
}

afterEach(() => vi.unstubAllGlobals());

describe('live crypto feed (mocked venues)', () => {
  it('reads Binance perps into a full board', async () => {
    mockFetch(binanceRoutes());
    const { data, feed } = await loadCrypto(10);
    expect(feed).toBe(binanceFeed);
    expect(data.source).toBe('Binance perps');
    expect(data.assets.map(a => a.symbol).slice(0, 3)).toEqual(['BTC', 'ETH', 'PEPE']);
    expect(data.assets.some(a => a.symbol === 'USDC')).toBe(false);
    const pepe = data.assets.find(a => a.symbol === 'PEPE')!;
    expect(pepe.candles.at(-1)!.c).toBeLessThan(0.00001); // 1000x contract unwrapped
    const btc = data.assets.find(a => a.symbol === 'BTC')!;
    expect(btc.options?.strikes.length).toBe(2);
    expect(btc.funding).toBeCloseTo(0.0001);
    expect(btc.candles.at(-1)!.tb).toBe(60);

    const flow = buildFlow({ ...data, asOf: NOW }, '24h');
    expect(flow.assets.length).toBe(10);
    expect(data.assets.some(a => a.symbol === 'XAU')).toBe(false);
    const xrp = flow.assets.find(a => a.symbol === 'XRP')!;
    expect(xrp.side).toBe('bearish');
    expect(xrp.buildUp.code).toBe('SHORT_BUILD');
    expect(flow.assets.find(a => a.symbol === 'BTC')!.resistance?.price).toBe(110000);
  });

  it('pulls only the latest bars on refresh', async () => {
    mockFetch(binanceRoutes());
    const { data, feed } = await loadCrypto(4);
    const before = data.assets[0].candles.length;
    const next = await feed.refresh(data);
    expect(next.assets[0].candles.length).toBe(before);
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map(c => String(c[0]));
    expect(calls.filter(u => u.includes('klines') && u.includes('limit=3')).length).toBe(4);
  });

  it('falls back to Bybit when Binance is blocked in the region', async () => {
    mockFetch(binanceRoutes(true));
    const { data } = await loadCrypto(8);
    expect(data.source).toBe('Bybit perps');
    expect(data.assets.length).toBe(8);
    const btc = data.assets.find(a => a.symbol === 'BTC')!;
    expect(btc.candles[0].t).toBeLessThan(btc.candles.at(-1)!.t); // reordered oldest first
    expect(btc.oi!.length).toBeGreaterThan(200); // two pages of OI history
    const flow = buildFlow({ ...data, asOf: NOW }, '4h');
    expect(flow.bullish.length + flow.bearish.length + flow.rangebound.length).toBe(8);
  });

  it('falls back to Gate.io where Binance and Bybit refuse (e.g. the US)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const route = binanceRoutes(true);
    mockFetch(url => (new URL(url).host === 'api.bybit.com' ? new Response('{}', { status: 403 }) : route(url)));
    const { data, feed } = await loadCrypto(8);
    expect(data.source).toBe('Gate.io perps');
    expect(data.assets.map(a => a.symbol).slice(0, 2)).toEqual(['BTC', 'ETH']);
    expect(data.assets.some(a => a.symbol === 'NVDA')).toBe(false);
    const btc = data.assets.find(a => a.symbol === 'BTC')!;
    expect(btc.oi!.length).toBeGreaterThan(250); // paged OI history
    expect(btc.candles.at(-1)!.tb).toBeCloseTo(btc.candles.at(-1)!.v * 0.6);
    expect(btc.venueSymbol).toBe('BTC_USDT');
    const flow = buildFlow({ ...data, asOf: NOW }, '24h');
    const sol = flow.assets.find(a => a.symbol === 'SOL')!;
    expect(sol.takerBuyShare).toBeCloseTo(0.6);
    expect(sol.buildUp.code).toBe('LONG_BUILD');
    const next = await feed.refresh(data);
    expect(next.assets.length).toBe(8);
    vi.useRealTimers();
  });

  it('reports why when no venue answers', async () => {
    mockFetch(() => new Response('nope', { status: 503 }));
    await expect(loadCrypto(10)).rejects.toThrow(/503/);
  });
});
