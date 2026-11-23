import type { AssetSeries, Candle, MarketData, OIPoint, StrikeRow } from './types';
import { CRYPTO_ASSETS, CRYPTO_EXCLUDE, THOUSAND_X } from './universe';
import { BAR, MIN } from './time';

/**
 * Live crypto perpetuals, read straight from the exchanges' public APIs in
 * the visitor's browser. No keys, no server.
 *
 *  1. Binance USDⓈ-M futures (taker volume + 5-minute open interest history).
 *  2. Bybit linear perps, when Binance is unreachable (some regions block it).
 *  3. Gate.io USDT perps, which also answer from the United States, where
 *     Binance and Bybit refuse connections.
 *  4. Deribit option open interest for BTC and ETH: the put and call walls.
 */

const LOOKBACK_BARS = 48 * 12; // 48h of 5-minute bars: 24h window plus a day for volume levels
const OI_BARS = 24 * 12 + 2;

export interface CryptoFeed {
  load(count: number): Promise<MarketData>;
  /** Pulls the latest bars into an existing file. */
  refresh(data: MarketData): Promise<MarketData>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.status === 429 && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; } // the venue asked us to slow down
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Runs tasks with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Splits a venue symbol into its base and the price multiplier (1000PEPEUSDT → PEPE, 1000). */
export function parseSymbol(venue: string): { base: string; mult: number } | null {
  if (!venue.endsWith('USDT')) return null;
  let base = venue.slice(0, -4);
  let mult = 1;
  const m = /^(1000000|10000|1000|1M)(.+)$/.exec(base);
  if (m && (THOUSAND_X.has(m[2]) || m[1] !== '1000')) {
    mult = m[1] === '1M' ? 1e6 : Number(m[1]);
    base = m[2];
  }
  if (!/^[A-Z0-9]+$/.test(base) || CRYPTO_EXCLUDE.has(base)) return null;
  return { base, mult };
}

const scaleCandle = (c: Candle, mult: number): Candle =>
  mult === 1 ? c : { ...c, o: c.o / mult, h: c.h / mult, l: c.l / mult, c: c.c / mult, v: c.v * mult, tb: c.tb == null ? undefined : c.tb * mult };

function mergeBars<T extends { t: number }>(old: T[], fresh: T[], keep: number): T[] {
  if (!fresh.length) return old;
  const first = fresh[0].t;
  const merged = [...old.filter(x => x.t < first), ...fresh];
  return merged.slice(-keep);
}

/* ---------------------------------------------------------------- Binance */

const BINANCE = 'https://fapi.binance.com';

type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

export const binanceKline = (k: BinanceKline): Candle => ({
  t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9],
});

interface BinanceOiHist { sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }

export const binanceFeed: CryptoFeed = {
  async load(count) {
    const [tickers, premium] = await Promise.all([
      getJson<Array<{ symbol: string; quoteVolume: string; lastPrice: string }>>(`${BINANCE}/fapi/v1/ticker/24hr`),
      getJson<Array<{ symbol: string; lastFundingRate: string }>>(`${BINANCE}/fapi/v1/premiumIndex`).catch(() => []),
    ]);
    const funding = new Map(premium.map(p => [p.symbol, +p.lastFundingRate]));
    const picked = pickUniverse(tickers.map(t => ({ venue: t.symbol, turnover: +t.quoteVolume })), count);
    const now = Date.now();
    const assets = await pool(picked, 8, async ({ venue, base, mult }) => {
      try {
        const [klines, oiHist] = await Promise.all([
          getJson<BinanceKline[]>(`${BINANCE}/fapi/v1/klines?symbol=${venue}&interval=5m&limit=${LOOKBACK_BARS}`),
          getJson<BinanceOiHist[]>(`${BINANCE}/futures/data/openInterestHist?symbol=${venue}&period=5m&limit=${OI_BARS}`).catch(() => []),
        ]);
        return toAsset(venue, base, mult, klines.map(binanceKline), oiHist.map(o => ({ t: o.timestamp, oi: +o.sumOpenInterest * mult })), oiHist.at(-1) ? +oiHist.at(-1)!.sumOpenInterestValue : null, funding.get(venue) ?? null);
      } catch {
        return null;
      }
    });
    const ok = assets.filter((a): a is AssetSeries => a != null);
    if (ok.length < Math.min(10, picked.length)) throw new Error('Binance answered for too few perps');
    await attachDeribit(ok);
    return { market: 'crypto', source: 'Binance perps', live: true, asOf: now, benchmark: 'BTC', assets: ok };
  },

  async refresh(data) {
    const now = Date.now();
    const premium = await getJson<Array<{ symbol: string; lastFundingRate: string }>>(`${BINANCE}/fapi/v1/premiumIndex`).catch(() => []);
    const funding = new Map(premium.map(p => [p.symbol, +p.lastFundingRate]));
    const assets = await pool(data.assets, 8, async a => {
      const venue = a.venueSymbol ?? `${a.symbol}USDT`;
      const mult = parseSymbol(venue)?.mult ?? 1;
      try {
        const [klines, oiHist] = await Promise.all([
          getJson<BinanceKline[]>(`${BINANCE}/fapi/v1/klines?symbol=${venue}&interval=5m&limit=3`),
          getJson<BinanceOiHist[]>(`${BINANCE}/futures/data/openInterestHist?symbol=${venue}&period=5m&limit=3`).catch(() => []),
        ]);
        return {
          ...a,
          candles: mergeBars(a.candles, klines.map(binanceKline).map(c => scaleCandle(c, mult)), LOOKBACK_BARS),
          oi: mergeBars(a.oi ?? [], oiHist.map(o => ({ t: o.timestamp, oi: +o.sumOpenInterest * mult })), OI_BARS),
          oiUsd: oiHist.at(-1) ? +oiHist.at(-1)!.sumOpenInterestValue : a.oiUsd,
          funding: funding.get(venue) ?? a.funding,
        };
      } catch {
        return a;
      }
    });
    return { ...data, asOf: now, assets };
  },
};

/* ---------------------------------------------------------------- Bybit */

const BYBIT = 'https://api.bybit.com';

interface BybitList<T> { retCode: number; retMsg: string; result: { list: T[]; nextPageCursor?: string } }

const bybitKlines = async (venue: string, limit: number): Promise<Candle[]> => {
  const res = await getJson<BybitList<string[]>>(`${BYBIT}/v5/market/kline?category=linear&symbol=${venue}&interval=5&limit=${limit}`);
  if (res.retCode !== 0) throw new Error(res.retMsg);
  // newest first; Bybit reports no taker split
  return res.result.list.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse();
};

const bybitOi = async (venue: string, limit: number): Promise<OIPoint[]> => {
  const out: OIPoint[] = [];
  let cursor = '';
  while (out.length < limit) {
    const page = Math.min(200, limit - out.length);
    const res = await getJson<BybitList<{ openInterest: string; timestamp: string }>>(
      `${BYBIT}/v5/market/open-interest?category=linear&symbol=${venue}&intervalTime=5min&limit=${page}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    if (res.retCode !== 0) break;
    out.push(...res.result.list.map(o => ({ t: +o.timestamp, oi: +o.openInterest })));
    cursor = res.result.nextPageCursor ?? '';
    if (!cursor || res.result.list.length < page) break;
  }
  return out.sort((a, b) => a.t - b.t);
};

interface BybitTicker { symbol: string; turnover24h: string; fundingRate: string; openInterestValue: string }

export const bybitFeed: CryptoFeed = {
  async load(count) {
    const tickers = await getJson<BybitList<BybitTicker>>(`${BYBIT}/v5/market/tickers?category=linear`);
    if (tickers.retCode !== 0) throw new Error(tickers.retMsg);
    const byVenue = new Map(tickers.result.list.map(t => [t.symbol, t]));
    const picked = pickUniverse(tickers.result.list.map(t => ({ venue: t.symbol, turnover: +t.turnover24h })), count);
    const now = Date.now();
    const assets = await pool(picked, 6, async ({ venue, base, mult }) => {
      try {
        const [candles, oi] = await Promise.all([bybitKlines(venue, LOOKBACK_BARS), bybitOi(venue, OI_BARS).catch(() => [])]);
        const t = byVenue.get(venue);
        return toAsset(venue, base, mult, candles, oi.map(o => ({ ...o, oi: o.oi * mult })), t ? +t.openInterestValue : null, t ? +t.fundingRate : null);
      } catch {
        return null;
      }
    });
    const ok = assets.filter((a): a is AssetSeries => a != null);
    if (ok.length < Math.min(10, picked.length)) throw new Error('Bybit answered for too few perps');
    await attachDeribit(ok);
    return { market: 'crypto', source: 'Bybit perps', live: true, asOf: now, benchmark: 'BTC', assets: ok };
  },

  async refresh(data) {
    const now = Date.now();
    const tickers = await getJson<BybitList<BybitTicker>>(`${BYBIT}/v5/market/tickers?category=linear`).catch(() => null);
    const byVenue = new Map((tickers?.result.list ?? []).map(t => [t.symbol, t]));
    const assets = await pool(data.assets, 6, async a => {
      const venue = a.venueSymbol ?? `${a.symbol}USDT`;
      const mult = parseSymbol(venue)?.mult ?? 1;
      try {
        const [candles, oi] = await Promise.all([bybitKlines(venue, 3), bybitOi(venue, 3).catch(() => [])]);
        const t = byVenue.get(venue);
        return {
          ...a,
          candles: mergeBars(a.candles, candles.map(c => scaleCandle(c, mult)), LOOKBACK_BARS),
          oi: mergeBars(a.oi ?? [], oi.map(o => ({ ...o, oi: o.oi * mult })), OI_BARS),
          oiUsd: t ? +t.openInterestValue : a.oiUsd,
          funding: t ? +t.fundingRate : a.funding,
        };
      } catch {
        return a;
      }
    });
    return { ...data, asOf: now, assets };
  },
};

/* ---------------------------------------------------------------- Gate.io */

const GATE = 'https://api.gateio.ws/api/v4/futures/usdt';
const GATE_STATS_PAGE = 100;

interface GateTicker { contract: string; last: string; volume_24h_quote: string; funding_rate: string }
interface GateCandle { t: number; o: string; h: string; l: string; c: string; v: number; sum: string }
interface GateStat { time: number; open_interest: number; open_interest_usd: number; long_taker_size: number; short_taker_size: number }

/** Gate counts volume in contracts; the quote turnover divided by price gives base units. */
export const gateCandle = (k: GateCandle): Candle => {
  const c = +k.c;
  return { t: k.t * 1000, o: +k.o, h: +k.h, l: +k.l, c, v: c > 0 ? +k.sum / c : 0 };
};

async function gateStats(contract: string, from: number): Promise<GateStat[]> {
  const out: GateStat[] = [];
  let cursor = Math.floor(from / 1000);
  for (let page = 0; page < 4; page++) {
    const rows = await getJson<GateStat[]>(`${GATE}/contract_stats?contract=${contract}&interval=5m&from=${cursor}&limit=${GATE_STATS_PAGE}`);
    out.push(...rows);
    if (rows.length < GATE_STATS_PAGE) break;
    cursor = rows[rows.length - 1].time + 300;
  }
  return out;
}

/** Adds the aggressive-buy share from Gate's stats onto the matching candles. */
export function withGateTaker(candles: Candle[], stats: GateStat[]): Candle[] {
  const share = new Map<number, number>();
  for (const s of stats) {
    const total = s.long_taker_size + s.short_taker_size;
    if (total > 0) share.set(s.time * 1000, s.long_taker_size / total);
  }
  return candles.map(c => (share.has(c.t) ? { ...c, tb: c.v * share.get(c.t)! } : c));
}

const gateOi = (stats: GateStat[]): OIPoint[] => stats.filter(s => s.open_interest > 0).map(s => ({ t: s.time * 1000, oi: s.open_interest }));

export const gateFeed: CryptoFeed = {
  async load(count) {
    const tickers = await getJson<GateTicker[]>(`${GATE}/tickers`);
    const byVenue = new Map(tickers.map(t => [t.contract.replace('_', ''), t]));
    const picked = pickUniverse(tickers.map(t => ({ venue: t.contract.replace('_', ''), turnover: +t.volume_24h_quote })), count);
    const now = Date.now();
    const assets = await pool(picked, 4, async ({ venue, base, mult }) => {
      const contract = byVenue.get(venue)!.contract;
      try {
        const [klines, stats] = await Promise.all([
          getJson<GateCandle[]>(`${GATE}/candlesticks?contract=${contract}&interval=5m&limit=${LOOKBACK_BARS}`),
          gateStats(contract, now - OI_BARS * BAR).catch(() => [] as GateStat[]),
        ]);
        const candles = withGateTaker(klines.map(gateCandle), stats);
        const asset = toAsset(venue, base, mult, candles, gateOi(stats), stats.at(-1)?.open_interest_usd ?? null, +byVenue.get(venue)!.funding_rate);
        if (asset) asset.venueSymbol = contract;
        return asset;
      } catch {
        return null;
      }
    });
    const ok = assets.filter((a): a is AssetSeries => a != null);
    if (ok.length < Math.min(10, picked.length)) throw new Error('Gate answered for too few perps');
    await attachDeribit(ok);
    return { market: 'crypto', source: 'Gate.io perps', live: true, asOf: now, benchmark: 'BTC', assets: ok };
  },

  async refresh(data) {
    const now = Date.now();
    const tickers = await getJson<GateTicker[]>(`${GATE}/tickers`).catch(() => [] as GateTicker[]);
    const funding = new Map(tickers.map(t => [t.contract, +t.funding_rate]));
    const assets = await pool(data.assets, 4, async a => {
      const contract = a.venueSymbol ?? `${a.symbol}_USDT`;
      try {
        const [klines, stats] = await Promise.all([
          getJson<GateCandle[]>(`${GATE}/candlesticks?contract=${contract}&interval=5m&limit=3`),
          getJson<GateStat[]>(`${GATE}/contract_stats?contract=${contract}&interval=5m&from=${Math.floor((now - 20 * 60_000) / 1000)}&limit=6`).catch(() => [] as GateStat[]),
        ]);
        return {
          ...a,
          candles: mergeBars(a.candles, withGateTaker(klines.map(gateCandle), stats), LOOKBACK_BARS),
          oi: mergeBars(a.oi ?? [], gateOi(stats), OI_BARS),
          oiUsd: stats.at(-1)?.open_interest_usd ?? a.oiUsd,
          funding: funding.get(contract) ?? a.funding,
        };
      } catch {
        return a;
      }
    });
    return { ...data, asOf: now, assets };
  },
};

/* ---------------------------------------------------------------- shared */

/** The most-traded perps by 24h turnover among the coins in universe.ts; BTC and ETH always included. */
export function pickUniverse(rows: Array<{ venue: string; turnover: number }>, count: number) {
  const seen = new Set<string>();
  const parsed = rows
    .map(r => ({ ...r, p: parseSymbol(r.venue) }))
    // Known coins only: venues also list tokenised stocks, gold and oil as perps.
    .filter((r): r is typeof r & { p: { base: string; mult: number } } => r.p != null && Number.isFinite(r.turnover) && r.p.base in CRYPTO_ASSETS)
    .sort((a, b) => b.turnover - a.turnover);
  const out: Array<{ venue: string; base: string; mult: number }> = [];
  for (const must of ['BTC', 'ETH']) {
    const r = parsed.find(x => x.p.base === must);
    if (r) { out.push({ venue: r.venue, ...r.p }); seen.add(must); }
  }
  for (const r of parsed) {
    if (out.length >= count) break;
    if (seen.has(r.p.base)) continue;
    seen.add(r.p.base);
    out.push({ venue: r.venue, ...r.p });
  }
  return out;
}

function toAsset(venue: string, base: string, mult: number, candles: Candle[], oi: OIPoint[], oiUsd: number | null, funding: number | null): AssetSeries | null {
  if (candles.length < 12) return null;
  const [name, sector] = CRYPTO_ASSETS[base] ?? [base, 'other'];
  return {
    symbol: base,
    venueSymbol: venue,
    name,
    sector,
    candles: candles.map(c => scaleCandle(c, mult)),
    oi: oi.filter(o => Number.isFinite(o.oi) && o.oi > 0),
    oiUsd,
    funding: funding != null && Number.isFinite(funding) ? funding : null,
  };
}

const DERIBIT = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency';
const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "BTC-27DEC26-100000-C" → expiry ms, strike, side. */
export function parseDeribit(name: string): { expiry: number; strike: number; side: 'C' | 'P' } | null {
  const m = /^[A-Z_]+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-([CP])$/.exec(name);
  if (!m || MONTHS[m[2]] == null) return null;
  return { expiry: Date.UTC(2000 + +m[3], MONTHS[m[2]], +m[1], 8), strike: +m[4].replace('d', '.'), side: m[5] as 'C' | 'P' };
}

/** Sums option OI by strike over expiries in the next 35 days. */
export function deribitStrikes(rows: Array<{ instrument_name: string; open_interest: number; volume: number }>, now: number) {
  const byStrike = new Map<number, StrikeRow>();
  let callVol = 0;
  let putVol = 0;
  for (const r of rows) {
    const p = parseDeribit(r.instrument_name);
    if (!p || p.expiry < now || p.expiry > now + 35 * 1440 * MIN) continue;
    const row = byStrike.get(p.strike) ?? [p.strike, 0, 0];
    if (p.side === 'C') { row[1] += r.open_interest; callVol += r.volume; } else { row[2] += r.open_interest; putVol += r.volume; }
    byStrike.set(p.strike, row);
  }
  return { callVol, putVol, strikes: [...byStrike.values()].sort((a, b) => a[0] - b[0]) };
}

async function attachDeribit(assets: AssetSeries[]) {
  await Promise.all(['BTC', 'ETH'].map(async currency => {
    const asset = assets.find(a => a.symbol === currency);
    if (!asset) return;
    try {
      const res = await getJson<{ result: Array<{ instrument_name: string; open_interest: number; volume: number }> }>(`${DERIBIT}?currency=${currency}&kind=option`, undefined, 8000);
      const book = deribitStrikes(res.result, Date.now());
      if (book.strikes.length) asset.options = book;
    } catch {
      /* the walls fall back to volume levels */
    }
  }));
}

/** Tries each venue in turn. */
export type Exchange = 'binance' | 'bybit' | 'gate';

export const FEEDS: Record<Exchange, CryptoFeed> = { binance: binanceFeed, bybit: bybitFeed, gate: gateFeed };

/** Tries each exchange in turn (or only the one asked for) and returns the first that answers. */
export async function loadCrypto(count: number, exchange: Exchange | 'auto' = 'auto'): Promise<{ data: MarketData; feed: CryptoFeed }> {
  const errors: string[] = [];
  const order = exchange === 'auto' ? Object.values(FEEDS) : [FEEDS[exchange]].filter((f): f is CryptoFeed => !!f);
  if (!order.length) throw new Error(`unknown exchange ${exchange}`);
  for (const feed of order) {
    try {
      return { data: await feed.load(count), feed };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join(' · '));
}

export { BAR };
