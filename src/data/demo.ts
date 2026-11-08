import type { AssetSeries, Candle, MarketData, OIPoint, StrikeRow } from './types';
import { CRYPTO_ASSETS, US_ASSETS } from './universe';
import { BAR, floorTo, lastUsSession, MIN, nyTime, nyDate } from './time';

/**
 * A simulated market for when no live source answers (offline, a blocked
 * region, or the US file has not been built yet). Deterministic: the same
 * moment gives the same board on every machine. It has a market mood, a
 * mood per sector and each asset's own move, and participation that agrees
 * with the move most of the time. Prices are illustrative, not quotes.
 */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A standard normal from a uniform source. */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

const CRYPTO_PRICES: Record<string, number> = {
  BTC: 104000, ETH: 3600, SOL: 178, XRP: 2.4, BNB: 980, DOGE: 0.19, ADA: 0.62, TRX: 0.29, AVAX: 21, SUI: 2.6, TON: 2.4,
  DOT: 3.4, NEAR: 2.5, APT: 4.1, LINK: 16.5, LTC: 98, BCH: 520, HYPE: 41, ENA: 0.42, AAVE: 230, UNI: 7.8, ARB: 0.36,
  OP: 0.52, PEPE: 0.0000078, SHIB: 0.0000112, BONK: 0.0000145, WIF: 0.58, TRUMP: 7.9, FARTCOIN: 0.38, PENGU: 0.019,
  WLD: 0.82, FET: 0.36, RENDER: 2.6, TAO: 410, VIRTUAL: 1.1, ONDO: 0.68, TIA: 1.15, SEI: 0.21, INJ: 9.2, LDO: 0.92,
  CRV: 0.56, PENDLE: 3.1, JUP: 0.39, XLM: 0.29, HBAR: 0.18, ETC: 15.8, ICP: 4.3, ALGO: 0.18, ATOM: 3.4, FIL: 1.9,
  ZEC: 520, XMR: 360, POL: 0.19, STX: 0.48, ASTER: 1.05, WLFI: 0.14, PUMP: 0.0042, XPL: 0.31, ORDI: 5.2, FLOKI: 0.000068,
};

const SECTOR_BETA: Record<string, number> = { majors: 0.8, l1: 1.2, l2: 1.3, defi: 1.25, meme: 1.8, ai: 1.5, rwa: 1.1, exchange: 0.9, payments: 1.0, other: 1.2 };

/** A day's mood from the date alone, so a day keeps its character. */
function dayMood(seedKey: string) {
  const r = rng(hash(seedKey));
  return { market: gauss(r) * 0.9, sectors: new Map<string, number>(), r };
}

interface WalkOpts {
  start: number;
  bars: number;
  price: number;
  vol: number; // per-bar sd, fraction
  drift: (bar: number) => number; // per-bar drift, fraction
  r: () => number;
  baseVolume: number;
  volumeShape?: (bar: number) => number;
}

function walk({ start, bars, price, vol, drift, r, baseVolume, volumeShape }: WalkOpts): Candle[] {
  const out: Candle[] = [];
  let p = price;
  for (let i = 0; i < bars; i++) {
    const ret = drift(i) + gauss(r) * vol;
    const o = p;
    const c = Math.max(o * (1 + ret), o * 0.5);
    const wick = Math.abs(gauss(r)) * vol * 0.6;
    const h = Math.max(o, c) * (1 + wick);
    const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * vol * 0.6);
    const shape = volumeShape ? volumeShape(i) : 1;
    const v = baseVolume * shape * (0.6 + r() * 0.8) * (1 + Math.abs(ret) / vol * 0.25);
    const buyShare = Math.min(0.85, Math.max(0.15, 0.5 + (ret / vol) * 0.07 + gauss(r) * 0.03));
    out.push({ t: start + i * BAR, o, h, l, c, v, tb: v * buyShare });
    p = c;
  }
  return out;
}

export function demoCrypto(now = Date.now(), count = 60): MarketData {
  const asOf = floorTo(now, MIN);
  const end = floorTo(asOf, BAR);
  const bars = 48 * 12 + 1;
  const start = end - (bars - 1) * BAR;
  const daySeed = new Date(start).toISOString().slice(0, 10);
  const mood = dayMood(`crypto:${daySeed}`);
  const sectorMood = (id: string) => {
    if (!mood.sectors.has(id)) mood.sectors.set(id, gauss(rng(hash(`${daySeed}:${id}`))) * 0.9);
    return mood.sectors.get(id)!;
  };
  // A market-wide path every name shares, so the board moves as one market.
  const mr = rng(hash(`common:${daySeed}`));
  const common = Array.from({ length: bars }, () => gauss(mr) * 0.0006 + mood.market * 0.0001);

  const symbols = Object.keys(CRYPTO_PRICES).slice(0, count);
  const assets: AssetSeries[] = symbols.map(sym => {
    const [name, sector] = CRYPTO_ASSETS[sym] ?? [sym, 'other'];
    const r = rng(hash(`${sym}:${daySeed}`));
    const beta = SECTOR_BETA[sector] ?? 1.2;
    const own = gauss(r) * 1.2 + sectorMood(sector) * 0.8;
    const turn = Math.floor(r() * bars);
    const turnSize = gauss(r) * 0.8;
    const vol = 0.0011 * beta * (sym === 'BTC' ? 0.7 : 1);
    const candles = walk({
      start, bars, price: CRYPTO_PRICES[sym], vol, r,
      baseVolume: 1e6 / CRYPTO_PRICES[sym] * (sym === 'BTC' ? 40 : sym === 'ETH' ? 25 : 3 + r() * 4),
      drift: i => common[i] * beta + (own + (i > turn ? turnSize : 0)) * vol * 0.04,
    });
    // Open interest: rises with fresh positioning, more often than not with the move.
    const oi: OIPoint[] = [];
    let units = (CRYPTO_PRICES[sym] > 0 ? 3e8 / CRYPTO_PRICES[sym] : 1e6) * (sym === 'BTC' ? 60 : sym === 'ETH' ? 30 : 0.4 + r() * 2);
    const fresh = r() < 0.65 ? 1 : -1;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const move = (c.c - c.o) / c.o / vol;
      units *= 1 + (Math.abs(move) * 0.0009 * fresh + gauss(r) * 0.0007);
      oi.push({ t: c.t + BAR, oi: units });
    }
    const last = candles[candles.length - 1].c;
    return {
      symbol: sym, name, sector, candles, oi, oiUsd: units * last,
      funding: Math.round((0.0001 + own * 0.00004 + gauss(r) * 0.00003) * 1e6) / 1e6,
      options: sym === 'BTC' || sym === 'ETH' ? demoStrikes(last, r, sym === 'BTC' ? 2000 : 100) : null,
    };
  });
  return { market: 'crypto', source: 'Demo market', live: true, note: 'simulated prices', asOf, benchmark: 'BTC', assets };
}

function demoStrikes(spot: number, r: () => number, step: number): { callVol: number; putVol: number; strikes: StrikeRow[] } {
  const strikes: StrikeRow[] = [];
  const atm = Math.round(spot / step) * step;
  for (let k = -12; k <= 12; k++) {
    const strike = atm + k * step;
    const round = strike % (step * 5) === 0 ? 2.4 : 1;
    const call = k >= 0 ? Math.exp(-Math.abs(k - 3) / 4) * round * (2000 + r() * 2000) : r() * 300;
    const put = k <= 0 ? Math.exp(-Math.abs(k + 3) / 4) * round * (2000 + r() * 2000) : r() * 300;
    strikes.push([strike, Math.round(call), Math.round(put)]);
  }
  return { callVol: Math.round(1e4 + r() * 2e4), putVol: Math.round(1e4 + r() * 2e4), strikes };
}

const US_PRICES: Record<string, number> = {
  SPY: 672, QQQ: 610, IWM: 245, NVDA: 188, TSLA: 445, AAPL: 268, MU: 225, AMD: 245, INTC: 38, META: 625, AMZN: 245,
  MSTR: 265, GOOGL: 280, PLTR: 182, ORCL: 245, CRWV: 105, HOOD: 135, AVGO: 345, MSFT: 505, SOFI: 28, IREN: 62, MARA: 18,
  WULF: 14, COIN: 315, IBIT: 58, SMH: 360, TSM: 300, ARM: 165, QCOM: 172, SMCI: 46, ASML: 1040, NFLX: 1110, UBER: 96,
  CRM: 245, ADBE: 335, NOW: 880, SNOW: 255, SHOP: 160, APP: 640, RDDT: 205, JPM: 305, BAC: 52, GS: 790, WFC: 86, V: 340,
  MA: 560, PYPL: 66, XOM: 116, CVX: 156, OXY: 42, LLY: 860, UNH: 335, JNJ: 188, PFE: 25, HIMS: 48, COST: 920, WMT: 102,
  HD: 380, NKE: 64, MCD: 300, RIVN: 13, F: 13, BA: 205, CAT: 560, GE: 300, LMT: 470, DIS: 112, T: 26, TLT: 90, GLD: 365,
};

const US_BETA: Record<string, number> = { etf: 0.7, semis: 1.6, tech: 1.1, software: 1.4, crypto: 2.4, fin: 1.0, consumer: 1.0, health: 0.7, energy: 0.9, industrial: 0.9, comm: 1.0 };

/** U-shaped intraday volume: heavy at the open and the close. */
const uShape = (slot: number, slots = 78) => {
  const x = slot / (slots - 1);
  return 0.55 + 1.6 * (x - 0.5) ** 2 * 4 * 0.5 + (slot < 3 ? 1.2 : 0) + (slot > slots - 4 ? 0.9 : 0);
};

export function demoUs(now = Date.now()): MarketData {
  const session = lastUsSession(now);
  const asOf = Math.min(floorTo(now, MIN), session.close);
  const slots = 78;
  const done = Math.max(1, Math.min(slots, Math.floor((asOf - session.open) / BAR)));
  const mood = dayMood(`us:${session.date}`);
  const sectorMood = (id: string) => {
    if (!mood.sectors.has(id)) mood.sectors.set(id, gauss(rng(hash(`${session.date}:${id}`))) * 0.8);
    return mood.sectors.get(id)!;
  };
  const mr = rng(hash(`uscommon:${session.date}`));
  const common = Array.from({ length: slots }, () => gauss(mr) * 0.0011 + mood.market * 0.00018);
  const prevDates: number[] = [];
  for (let back = 1, t = session.open; prevDates.length < 4 && back < 12; back++) {
    const { date, weekday } = nyDate(t - back * 1440 * MIN);
    if (weekday === 0 || weekday === 6) continue;
    prevDates.push(nyTime(date, 9, 30));
  }

  const assets: AssetSeries[] = US_ASSETS.map(([symbol, name, sector]) => {
    const r = rng(hash(`${symbol}:${session.date}`));
    const ref = US_PRICES[symbol] ?? 100;
    const beta = symbol === 'SPY' || symbol === 'QQQ' ? 1 : symbol === 'IWM' ? 1.2 : (US_BETA[sector] ?? 1);
    const vol = sector === 'etf' ? 0.0006 : 0.0011 * beta * (0.8 + r() * 0.5);
    const baseVolume = (symbol === 'SPY' ? 8e5 : symbol === 'QQQ' ? 5e5 : 4e7 / ref) * (0.5 + r());
    const own = sector === 'etf' ? 0 : gauss(r) * 1.1 + sectorMood(sector) * 0.9;
    const gap = (mood.market * 0.4 + own * 0.5) * vol * 3;
    // Prior sessions, for relative volume.
    const prior: Candle[] = [];
    let p = ref * (1 - gap * 2);
    for (const open of [...prevDates].reverse()) {
      const day = walk({ start: open, bars: slots, price: p, vol, r, baseVolume, volumeShape: uShape, drift: () => gauss(r) * vol * 0.05 });
      prior.push(...day);
      p = day[day.length - 1].c;
    }
    const prevClose = p;
    const heavy = r() < 0.55 ? 1.5 : 0.75;
    const today = walk({
      start: session.open, bars: done, price: prevClose * (1 + gap), vol, r,
      baseVolume: baseVolume * heavy, volumeShape: uShape,
      drift: i => (sector === 'etf' ? common[i] * beta * 0.9 : common[i] * beta) + own * vol * 0.1,
    });
    const avgSlotVol = Array.from({ length: slots }, (_, slot) => {
      let s = 0;
      let n = 0;
      for (let d = 0; d < prevDates.length; d++) { const c = prior[d * slots + slot]; if (c) { s += c.v; n++; } }
      return n ? s / n : 0;
    });
    const spot = today[today.length - 1].c;
    const step = spot > 500 ? 10 : spot > 200 ? 5 : spot > 50 ? 2.5 : spot > 20 ? 1 : 0.5;
    const opts = demoStrikes(spot, r, step);
    const lean = own * 0.25;
    opts.callVol = Math.round(opts.callVol * Math.exp(lean));
    opts.putVol = Math.round(opts.putVol * Math.exp(-lean));
    return { symbol, name, sector, candles: [...prior, ...today].map(({ tb: _tb, ...c }) => c), prevClose, avgSlotVol, options: opts };
  });
  return {
    market: 'us', source: 'Demo session', live: false, note: 'simulated prices', asOf,
    session: { open: session.open, close: session.close }, benchmark: 'SPY', assets,
  };
}
