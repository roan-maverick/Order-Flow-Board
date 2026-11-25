import type { AssetSeries, Candle, MarketData, MarketId, StrikeRow } from '../data/types';
import { sectorLabel } from '../data/universe';

/**
 * The flow model: every asset read over a window, sorted onto a side (bullish,
 * bearish or rangebound), given a build-up (how participation moved with
 * price), five checks of conviction, levels and a zone.
 *
 * Crypto reads build-up from perpetual open interest, the same way a futures
 * board does: price and OI together.
 *
 * US stocks have no single-stock futures, so build-up comes from volume: is
 * the move happening on more or less volume than this stock usually trades by
 * this point in the session (relative volume)? Levels come from listed option
 * open interest by strike (put wall / call wall).
 */

export type WindowId = '24h' | '4h' | '1h' | 'day' | '15m';
export type Side = 'bullish' | 'bearish' | 'rangebound';
export type Dir = Exclude<Side, 'rangebound'>;

export interface WindowDef {
  id: WindowId;
  label: string;
  minutes: number | null; // null = the US session since the previous close
  floor: number; // smallest move, %, that counts as a direction
  confirm: WindowId; // the shorter window the "agrees" check compares with
  scope: string;
}

export const WINDOWS: Record<MarketId, WindowDef[]> = {
  crypto: [
    { id: '24h', label: '24h', minutes: 1440, floor: 1, confirm: '1h', scope: 'over the last 24 hours' },
    { id: '4h', label: '4h', minutes: 240, floor: 0.5, confirm: '1h', scope: 'over the last 4 hours' },
    { id: '1h', label: '1h', minutes: 60, floor: 0.25, confirm: '15m', scope: 'over the last hour' },
  ],
  us: [
    { id: 'day', label: 'Day', minutes: null, floor: 0.5, confirm: '1h', scope: 'since the previous close' },
    { id: '1h', label: '1h', minutes: 60, floor: 0.25, confirm: '15m', scope: 'over the last hour' },
    { id: '15m', label: '15m', minutes: 15, floor: 0.12, confirm: '1h', scope: 'over the last 15 minutes' },
  ],
};

/** Windows used only as the "shorter window agrees" check, not offered on the board. */
const CHECK_ONLY: Record<MarketId, WindowDef[]> = {
  crypto: [{ id: '15m', label: '15m', minutes: 15, floor: 0.12, confirm: '1h', scope: 'over the last 15 minutes' }],
  us: [],
};

export const windowDef = (market: MarketId, id: WindowId): WindowDef =>
  WINDOWS[market].find(w => w.id === id) ?? CHECK_ONLY[market].find(w => w.id === id) ?? WINDOWS[market][0];

export type BuildUpCode =
  | 'LONG_BUILD' | 'SHORT_COVER' | 'SHORT_BUILD' | 'LONG_UNWIND' // crypto, from OI
  | 'ACCUMULATION' | 'DRIFT_UP' | 'DISTRIBUTION' | 'DRIFT_DOWN' // US, from relative volume
  | 'NEUTRAL';

export interface BuildUp {
  code: BuildUpCode;
  label: string;
  /** true: new positions / heavy volume behind the move. false: positions closing / thin volume. */
  fresh: boolean;
  dir: Dir | null;
}

export const BUILDUPS: Record<BuildUpCode, BuildUp> = {
  LONG_BUILD: { code: 'LONG_BUILD', label: 'Long build-up', fresh: true, dir: 'bullish' },
  SHORT_COVER: { code: 'SHORT_COVER', label: 'Short covering', fresh: false, dir: 'bullish' },
  SHORT_BUILD: { code: 'SHORT_BUILD', label: 'Short build-up', fresh: true, dir: 'bearish' },
  LONG_UNWIND: { code: 'LONG_UNWIND', label: 'Long unwinding', fresh: false, dir: 'bearish' },
  ACCUMULATION: { code: 'ACCUMULATION', label: 'Bought on heavy volume', fresh: true, dir: 'bullish' },
  DRIFT_UP: { code: 'DRIFT_UP', label: 'Rising on light volume', fresh: false, dir: 'bullish' },
  DISTRIBUTION: { code: 'DISTRIBUTION', label: 'Sold on heavy volume', fresh: true, dir: 'bearish' },
  DRIFT_DOWN: { code: 'DRIFT_DOWN', label: 'Falling on light volume', fresh: false, dir: 'bearish' },
  NEUTRAL: { code: 'NEUTRAL', label: 'No change in participation', fresh: false, dir: null },
};

export type CheckId = 'fresh' | 'confirm' | 'flow' | 'market' | 'sector';
export interface Check {
  id: CheckId;
  label: string;
  pass: boolean | null; // null: cannot be measured (not counted)
  note: string;
}

export interface Level {
  price: number;
  weight: number; // OI or volume at the level
  distancePct: number;
  kind: 'options' | 'volume';
}

export interface Zone {
  low: number;
  high: number;
  from: number;
  to: number;
}

export interface ProfileRow {
  price: number;
  /** options: put OI / call OI. volume: volume below / above spot split onto the matching side. */
  left: number;
  right: number;
}

export interface Point {
  t: number;
  pct: number;
}

export interface FlowAsset {
  symbol: string;
  name: string;
  sector: string;
  sectorLabel: string;
  price: number;
  base: number;
  changePct: number;
  side: Side;
  points: Point[];
  buildUp: BuildUp;
  /** crypto: OI change over the window, %. */
  oiChangePct: number | null;
  /** US: window volume against its usual pace (1 = normal). */
  rvol: number | null;
  /** Share of volume bought by takers over the window (crypto, when reported). */
  takerBuyShare: number | null;
  funding: number | null;
  oiValue: number | null;
  callPutRatio: number | null;
  checks: Check[];
  checksHeld: number;
  checksCounted: number;
  strength: number;
  rank: number | null;
  support: Level | null;
  resistance: Level | null;
  zone: Zone | null;
  profile: ProfileRow[];
  candles: Candle[]; // the window's candles, for the detail chart
  isBenchmark: boolean;
}

export interface FlowSector {
  id: string;
  label: string;
  changePct: number;
  lean: Side | 'mixed';
  bullish: number;
  bearish: number;
  rangebound: number;
  symbols: string[];
}

export interface Flow {
  market: MarketId;
  window: WindowDef;
  asOf: number;
  start: number;
  end: number;
  source: string;
  live: boolean;
  note?: string;
  benchmark: FlowAsset | null;
  assets: FlowAsset[];
  bullish: FlowAsset[];
  bearish: FlowAsset[];
  rangebound: FlowAsset[];
  sectors: FlowSector[];
  featured: { bullish: FlowAsset[]; bearish: FlowAsset[] };
}

const MIN = 60_000;
const BAR = 5 * MIN;
/** Big cards shown on each side of the board. */
const CARDS_PER_SIDE = 3;
/** How strength is mixed: 45% size of move, 35% conviction behind it, 20% checks held. */
const MIX_MOVE = 0.45;
const MIX_CONVICTION = 0.35;
const MIX_CHECKS = 0.2;

export const pctOf = (now: number, from: number) => (from > 0 ? ((now - from) / from) * 100 : 0);
const sign = (x: number | null | undefined, eps = 1e-9): -1 | 0 | 1 => (x == null || Math.abs(x) <= eps ? 0 : x > 0 ? 1 : -1);

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Where `value` ranks among `pool`, from 0 (smallest) to 1 (largest). */
function rankIn(pool: number[], value: number): number {
  const others = pool.length - 1;
  return others > 0 ? pool.filter(x => x < value).length / others : 1;
}

/** The window's start time for a market file. */
export function windowStart(data: Pick<MarketData, 'asOf' | 'session'>, win: WindowDef): number {
  if (win.minutes == null) return data.session?.open ?? data.asOf - 390 * MIN;
  return data.asOf - win.minutes * MIN;
}

interface Slice {
  base: number;
  candles: Candle[];
  points: Point[];
}

/**
 * The candles inside [start, asOf] and the price the move is measured from:
 * the close of the bar before the window (or the US previous close for the
 * day window), else the first bar's open.
 */
export function sliceWindow(series: AssetSeries, start: number, asOf: number, usePrevClose: boolean): Slice | null {
  const all = series.candles;
  if (!all.length) return null;
  const i = all.findIndex(c => c.t >= start);
  if (i < 0) return null;
  const candles = all.slice(i).filter(c => c.t <= asOf);
  if (!candles.length) return null;
  let base: number;
  if (usePrevClose && series.prevClose && series.prevClose > 0) base = series.prevClose;
  else if (i > 0) base = all[i - 1].c;
  else base = candles[0].o;
  const points: Point[] = [{ t: candles[0].t, pct: 0 }];
  for (const c of candles) points.push({ t: c.t + BAR, pct: pctOf(c.c, base) });
  return { base, candles, points };
}

/** Value of the OI series nearest at or before t (or the first after). */
function oiAt(series: AssetSeries, t: number): number | null {
  const oi = series.oi;
  if (!oi?.length) return null;
  let best: number | null = null;
  for (const p of oi) {
    if (p.t <= t) best = p.oi;
    else break;
  }
  return best ?? oi[0].oi;
}

/** Volume over [start, asOf] against what this asset usually trades over the same slots. */
function relativeVolume(series: AssetSeries, candles: Candle[], sessionOpen: number | undefined): number | null {
  const avg = series.avgSlotVol;
  if (!avg?.length || sessionOpen == null || !candles.length) return null;
  let actual = 0;
  let usual = 0;
  for (const c of candles) {
    const slot = Math.floor((c.t - sessionOpen) / BAR);
    if (slot < 0 || slot >= avg.length) continue;
    actual += c.v;
    usual += avg[slot];
  }
  return usual > 0 ? actual / usual : null;
}

function buildUpOf(market: MarketId, dir: -1 | 0 | 1, oiChangePct: number | null, rvol: number | null): BuildUp {
  if (dir === 0) return BUILDUPS.NEUTRAL;
  if (market === 'crypto') {
    if (oiChangePct == null || Math.abs(oiChangePct) < 0.05) return BUILDUPS.NEUTRAL;
    if (dir > 0) return oiChangePct > 0 ? BUILDUPS.LONG_BUILD : BUILDUPS.SHORT_COVER;
    return oiChangePct > 0 ? BUILDUPS.SHORT_BUILD : BUILDUPS.LONG_UNWIND;
  }
  if (rvol == null) return BUILDUPS.NEUTRAL;
  const heavy = rvol >= 1;
  if (dir > 0) return heavy ? BUILDUPS.ACCUMULATION : BUILDUPS.DRIFT_UP;
  return heavy ? BUILDUPS.DISTRIBUTION : BUILDUPS.DRIFT_DOWN;
}

/** The heaviest option OI on each side of spot: puts below as support, calls above as resistance. */
export function optionLevels(strikes: StrikeRow[], spot: number): { support: Level | null; resistance: Level | null } {
  let support: Level | null = null;
  let resistance: Level | null = null;
  for (const [k, call, put] of strikes) {
    if (k <= spot && put > 0 && (!support || put > support.weight)) support = { price: k, weight: put, distancePct: pctOf(k, spot), kind: 'options' };
    if (k >= spot && call > 0 && (!resistance || call > resistance.weight)) resistance = { price: k, weight: call, distancePct: pctOf(k, spot), kind: 'options' };
  }
  return { support, resistance };
}

const PROFILE_BINS = 36;

/** Volume by price over the candles: [low edge, volume] buckets. */
export function volumeProfile(candles: Candle[], bins = PROFILE_BINS): { lo: number; step: number; vol: number[] } | null {
  if (candles.length < 6) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins;
  const vol = new Array<number>(bins).fill(0);
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    const b = Math.min(bins - 1, Math.max(0, Math.floor((typical - lo) / step)));
    vol[b] += c.v * typical;
  }
  return { lo, step, vol };
}

/**
 * Volume shelves: the price bands where the most trading happened over the
 * last two sessions, below and above the price. Bands right next to the price
 * are skipped (they are "here", not a level): a shelf must be at least about
 * three typical 5-minute ranges away.
 */
export function volumeLevels(candles: Candle[], spot: number): { support: Level | null; resistance: Level | null } {
  const vp = volumeProfile(candles);
  if (!vp) return { support: null, resistance: null };
  const ranges = candles.map(c => (c.h - c.l) / (c.c || 1)).filter(r => r > 0).sort((a, b) => a - b);
  const typicalRange = ranges.length ? ranges[Math.floor(ranges.length / 2)] : 0.002;
  const minGap = Math.max(spot * 0.003, spot * typicalRange * 3, vp.step);
  let support: Level | null = null;
  let resistance: Level | null = null;
  vp.vol.forEach((v, b) => {
    const mid = vp.lo + (b + 0.5) * vp.step;
    if (Math.abs(mid - spot) < minGap || v <= 0) return;
    // Only local peaks count as shelves.
    const left = vp.vol[b - 1] ?? 0;
    const right = vp.vol[b + 1] ?? 0;
    if (v < left || v < right) return;
    if (mid < spot && (!support || v > support.weight)) support = { price: mid, weight: v, distancePct: pctOf(mid, spot), kind: 'volume' };
    if (mid > spot && (!resistance || v > resistance.weight)) resistance = { price: mid, weight: v, distancePct: pctOf(mid, spot), kind: 'volume' };
  });
  return { support, resistance };
}

function profileRows(series: AssetSeries, spot: number, lookback: Candle[]): ProfileRow[] {
  const strikes = series.options?.strikes;
  if (strikes?.length) {
    const sorted = [...strikes].sort((a, b) => a[0] - b[0]);
    const below = sorted.filter(r => r[0] <= spot).slice(-6);
    const above = sorted.filter(r => r[0] > spot).slice(0, 6);
    return [...below, ...above].map(([price, call, put]) => ({ price, left: put, right: call }));
  }
  const vp = volumeProfile(lookback, 12);
  if (!vp) return [];
  return vp.vol.map((v, b) => {
    const price = vp.lo + (b + 0.5) * vp.step;
    return { price, left: price <= spot ? v : 0, right: price > spot ? v : 0 };
  });
}

/** The 15-minute stretch where the most participation was added while price moved the side's way. */
export function readZone(slice: Candle[], series: AssetSeries, dir: Dir, market: MarketId): Zone | null {
  const span = 3;
  if (slice.length < span) return null;
  const want = dir === 'bullish' ? 1 : -1;
  let best: { score: number; zone: Zone } | null = null;
  for (let end = span - 1; end < slice.length; end++) {
    const first = slice[end - span + 1];
    const last = slice[end];
    if (sign(last.c - first.o) !== want) continue;
    let score: number;
    if (market === 'crypto' && series.oi?.length) {
      const a = oiAt(series, first.t);
      const b = oiAt(series, last.t + BAR);
      if (a == null || b == null) continue;
      score = b - a;
    } else {
      score = 0;
      for (let i = end - span + 1; i <= end; i++) score += slice[i].v;
    }
    if (!(score > 0) || (best && score <= best.score)) continue;
    let low = Infinity;
    let high = -Infinity;
    for (let i = end - span + 1; i <= end; i++) { low = Math.min(low, slice[i].l); high = Math.max(high, slice[i].h); }
    best = { score, zone: { low, high, from: first.t, to: last.t + BAR } };
  }
  return best?.zone ?? null;
}

const fmtPct = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;

interface Raw {
  series: AssetSeries;
  slice: Slice;
  changePct: number;
  side: Side;
  confirmPct: number | null;
  oiChangePct: number | null;
  rvol: number | null;
  takerBuyShare: number | null;
  buildUp: BuildUp;
}

export function buildFlow(data: MarketData, windowId: WindowId, opts: { symbols?: ReadonlySet<string> } = {}): Flow {
  const win = windowDef(data.market, windowId);
  const start = windowStart(data, win);
  const confirmWin = windowDef(data.market, win.confirm);
  const confirmStart = windowStart(data, confirmWin);
  const usePrev = win.minutes == null;

  const raws: Raw[] = [];
  for (const series of data.assets) {
    if (opts.symbols && !opts.symbols.has(series.symbol) && series.symbol !== data.benchmark) continue;
    const slice = sliceWindow(series, start, data.asOf, usePrev);
    if (!slice) continue;
    const last = slice.candles[slice.candles.length - 1];
    const changePct = pctOf(last.c, slice.base);
    const side: Side = Math.abs(changePct) >= win.floor ? (changePct > 0 ? 'bullish' : 'bearish') : 'rangebound';
    const cSlice = sliceWindow(series, confirmStart, data.asOf, confirmWin.minutes == null);
    const confirmPct = cSlice ? pctOf(last.c, cSlice.base) : null;

    let oiChangePct: number | null = null;
    if (series.oi?.length) {
      const a = oiAt(series, start);
      const b = series.oi[series.oi.length - 1].oi;
      if (a && a > 0) oiChangePct = pctOf(b, a);
    }
    const rvol = data.market === 'us' ? relativeVolume(series, slice.candles, data.session?.open) : null;
    let takerBuyShare: number | null = null;
    const vol = slice.candles.reduce((s, c) => s + c.v, 0);
    // Taker split over the bars that carry it, when they cover most of the window.
    const withTaker = slice.candles.filter(c => c.tb != null);
    const takerVol = withTaker.reduce((s, c) => s + c.v, 0);
    if (vol > 0 && withTaker.length >= slice.candles.length * 0.8 && takerVol > 0) takerBuyShare = withTaker.reduce((s, c) => s + (c.tb ?? 0), 0) / takerVol;
    const buildUp = buildUpOf(data.market, sign(changePct), oiChangePct, rvol);
    raws.push({ series, slice, changePct, side, confirmPct, oiChangePct, rvol, takerBuyShare, buildUp });
  }

  // Sectors: the median move of their members.
  const bySector = new Map<string, Raw[]>();
  for (const r of raws) {
    const list = bySector.get(r.series.sector) ?? [];
    list.push(r);
    bySector.set(r.series.sector, list);
  }
  const sectors: FlowSector[] = [...bySector.entries()].map(([id, list]) => {
    const changePct = median(list.map(r => r.changePct));
    const counts = { bullish: 0, bearish: 0, rangebound: 0 };
    for (const r of list) counts[r.side]++;
    const lean: FlowSector['lean'] = Math.abs(changePct) >= win.floor / 2 ? (changePct > 0 ? 'bullish' : 'bearish') : list.length > 1 && counts.bullish && counts.bearish ? 'mixed' : 'rangebound';
    return { id, label: sectorLabel(data.market, id), changePct, lean, ...counts, symbols: list.map(r => r.series.symbol) };
  }).sort((a, b) => b.changePct - a.changePct);
  const sectorOf = new Map(sectors.map(s => [s.id, s]));

  const bench = raws.find(r => r.series.symbol === data.benchmark) ?? null;
  const calPuts = raws.map(r => cpRatio(r.series)).filter((x): x is number => x != null);
  const cpMedian = calPuts.length >= 5 ? median(calPuts) : null;

  const assets: FlowAsset[] = raws.map(r => {
    const { series, slice } = r;
    const last = slice.candles[slice.candles.length - 1];
    const spot = last.c;
    const isBenchmark = series.symbol === data.benchmark;
    const dir: Dir | null = r.side === 'rangebound' ? (r.changePct >= 0 ? 'bullish' : 'bearish') : r.side;
    const sector = sectorOf.get(series.sector);
    const sectorUsable = sector && sector.symbols.length >= 3;
    const cp = cpRatio(series);
    const checks: Check[] = [];

    // 1. Participation moved with price
    if (data.market === 'crypto') {
      checks.push({
        id: 'fresh', label: 'New positions opened with the move',
        pass: r.oiChangePct == null ? null : r.buildUp.fresh && r.buildUp.dir === dir,
        note: r.oiChangePct == null ? 'no open interest history from the venue' : `open interest ${fmtPct(r.oiChangePct)} with price ${fmtPct(r.changePct)}`,
      });
    } else {
      checks.push({
        id: 'fresh', label: 'Heavy volume behind the move',
        pass: r.rvol == null ? null : r.rvol >= 1,
        note: r.rvol == null ? 'no volume history to compare with' : `volume at ${r.rvol.toFixed(2)}× its usual pace for this time of day`,
      });
    }
    // 2. The shorter window agrees
    checks.push({
      id: 'confirm', label: `The last ${confirmWin.label === '1h' ? 'hour' : confirmWin.label === '15m' ? '15 minutes' : confirmWin.label} agrees`,
      pass: r.confirmPct == null ? null : sign(r.confirmPct, 1e-6) !== 0 && (r.confirmPct > 0) === (dir === 'bullish'),
      note: r.confirmPct == null ? 'not enough bars yet' : `${fmtPct(r.confirmPct)} ${confirmWin.scope}`,
    });
    // 3. Aggressor / options flow
    if (data.market === 'crypto') {
      checks.push({
        id: 'flow', label: dir === 'bullish' ? 'Aggressive buyers lead' : 'Aggressive sellers lead',
        pass: r.takerBuyShare == null ? null : dir === 'bullish' ? r.takerBuyShare > 0.5 : r.takerBuyShare < 0.5,
        note: r.takerBuyShare == null ? 'this venue does not report taker volume' : `${(r.takerBuyShare * 100).toFixed(1)}% of volume was market buys`,
      });
    } else {
      checks.push({
        id: 'flow', label: 'Options traders lean the same way',
        pass: cp == null || cpMedian == null ? null : dir === 'bullish' ? cp > cpMedian : cp < cpMedian,
        note: cp == null ? 'no options volume for this name' : `call/put volume ${cp.toFixed(2)} against a board median of ${cpMedian?.toFixed(2) ?? '—'}`,
      });
    }
    // 4. The benchmark agrees
    checks.push({
      id: 'market', label: `${data.benchmark} moves the same way`,
      pass: isBenchmark || !bench ? null : sign(bench.changePct, 1e-6) !== 0 && (bench.changePct > 0) === (dir === 'bullish'),
      note: isBenchmark ? `this is the benchmark` : !bench ? `${data.benchmark} is not on the board` : `${data.benchmark} ${fmtPct(bench.changePct)} ${win.scope}`,
    });
    // 5. The sector agrees
    checks.push({
      id: 'sector', label: 'The sector agrees',
      pass: !sectorUsable ? null : sector!.lean === dir,
      note: !sectorUsable ? 'too few names in the sector to say' : `${sector!.label} median ${fmtPct(sector!.changePct)}`,
    });

    const counted = checks.filter(c => c.pass != null);
    const held = counted.filter(c => c.pass).length;

    const lookback = series.candles.filter(c => c.t > data.asOf - 2 * 1440 * MIN);
    const levels = series.options?.strikes?.length ? optionLevels(series.options.strikes, spot) : volumeLevels(lookback, spot);
    const zone = r.side === 'rangebound' ? null : readZone(slice.candles, series, r.side, data.market);

    return {
      symbol: series.symbol,
      name: series.name,
      sector: series.sector,
      sectorLabel: sector?.label ?? sectorLabel(data.market, series.sector),
      price: spot,
      base: slice.base,
      changePct: r.changePct,
      side: r.side,
      points: slice.points,
      buildUp: r.buildUp,
      oiChangePct: r.oiChangePct,
      rvol: r.rvol,
      takerBuyShare: r.takerBuyShare,
      funding: series.funding ?? null,
      oiValue: series.oiUsd ?? null,
      callPutRatio: cp,
      checks,
      checksHeld: held,
      checksCounted: counted.length,
      strength: 0,
      rank: null,
      support: levels.support,
      resistance: levels.resistance,
      zone,
      profile: profileRows(series, spot, lookback),
      candles: slice.candles,
      isBenchmark,
    };
  });

  // Strength within each side: the move, the participation behind it, the checks.
  for (const side of ['bullish', 'bearish'] as const) {
    const list = assets.filter(a => a.side === side);
    const moves = list.map(a => Math.abs(a.changePct));
    const convs = list.map(conviction);
    for (const a of list) {
      const held = a.checksCounted ? a.checksHeld / a.checksCounted : 0;
      a.strength = MIX_MOVE * rankIn(moves, Math.abs(a.changePct)) + MIX_CONVICTION * rankIn(convs, conviction(a)) + MIX_CHECKS * held;
    }
    list.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).forEach((a, i) => { a.rank = i + 1; });
  }

  const sideList = (side: Side) => assets.filter(a => a.side === side).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const bullish = sideList('bullish');
  const bearish = sideList('bearish');
  const rangebound = sideList('rangebound');
  const pick = (list: FlowAsset[]) => [...list].filter(a => !a.isBenchmark).sort((a, b) => b.strength - a.strength).slice(0, CARDS_PER_SIDE);

  return {
    market: data.market,
    window: win,
    asOf: data.asOf,
    start,
    end: data.market === 'us' && data.session ? Math.max(data.session.close, data.asOf) : data.asOf,
    source: data.source,
    live: data.live,
    note: data.note,
    benchmark: assets.find(a => a.isBenchmark) ?? null,
    assets,
    bullish,
    bearish,
    rangebound,
    sectors,
    featured: { bullish: pick(bullish), bearish: pick(bearish) },
  };
}

function cpRatio(series: AssetSeries): number | null {
  const o = series.options;
  if (!o || o.callVol == null || o.putVol == null || !(o.putVol > 0)) return null;
  return o.callVol / o.putVol;
}

/** How much participation moved with the side: fresh in full, closing at half. */
function conviction(a: FlowAsset): number {
  if (a.oiChangePct != null) return a.buildUp.fresh ? Math.max(a.oiChangePct, 0) : Math.abs(a.oiChangePct) / 2;
  if (a.rvol != null) return a.buildUp.fresh ? a.rvol : a.rvol / 2;
  return 0;
}
