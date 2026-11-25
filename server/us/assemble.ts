import type { AssetSeries, Candle, MarketData, OptionsBook } from '../../src/data/types';
import { BAR, nyDate, usSessionOf } from '../../src/data/time';

/**
 * Turns what the server has collected per stock into the market file the
 * board reads: the latest session's bars, the previous session (for levels),
 * the previous close, and the usual volume of each 5-minute slot (for
 * relative volume).
 */
export const SESSION_SLOTS = 78; // 6.5 hours of 5-minute bars
const PRIOR_SESSIONS_FOR_VOLUME = 4;

export interface SymbolState {
  symbol: string;
  name: string;
  sector: string;
  group: 'sp500' | 'etf' | 'popular';
  /** 5-minute bars, oldest first, up to about a week. */
  bars: Candle[];
  /** Yahoo's official previous close and the session date it belongs before. */
  officialPrev?: { date: string; close: number };
  /** Yahoo's regular session for the latest date (start/end, catches half days). */
  regular?: { start: number; end: number } | null;
  /** Yahoo's official latest price and its time: after the close this is the closing auction, which 5-minute bars miss. */
  lastPrice?: { t: number; price: number } | null;
  options?: (OptionsBook & { fetchedAt: number }) | null;
  error?: string;
}

const dateOf = (t: number) => nyDate(t).date;
/** Yahoo prices come as floats like 722.5599975585938: seven significant digits is plenty, and halves the download. */
const tidy = (c: Candle): Candle => ({ t: c.t, o: +c.o.toPrecision(7), h: +c.h.toPrecision(7), l: +c.l.toPrecision(7), c: +c.c.toPrecision(7), v: Math.round(c.v) });

/** Merges fresh bars into stored ones: fresh bars replace anything from their first timestamp on. */
export function mergeBars(old: Candle[], fresh: Candle[], keepDays = 7): Candle[] {
  if (!fresh.length) return old;
  const first = fresh[0].t;
  const merged = [...old.filter(c => c.t < first), ...fresh];
  const cutoff = fresh[fresh.length - 1].t - keepDays * 86_400_000;
  return merged.filter(c => c.t >= cutoff);
}

/** Splits bars into sessions by New York date, oldest first. */
export function sessions(bars: Candle[]): Array<{ date: string; bars: Candle[] }> {
  const out: Array<{ date: string; bars: Candle[] }> = [];
  for (const c of bars) {
    const date = dateOf(c.t);
    const last = out[out.length - 1];
    if (last && last.date === date) last.bars.push(c);
    else out.push({ date, bars: [c] });
  }
  return out;
}

export interface AssembleOptions {
  now: number;
  benchmark: string;
  source: string;
  note?: string;
}

export function assembleUs(states: SymbolState[], opts: AssembleOptions): MarketData | null {
  // The session shown is the latest date the benchmark (or, failing that, anyone) has bars for.
  const bench = states.find(s => s.symbol === opts.benchmark && s.bars.length);
  const latestBar = bench?.bars[bench.bars.length - 1] ?? states.flatMap(s => s.bars.slice(-1)).sort((a, b) => b.t - a.t)[0];
  if (!latestBar) return null;
  const sessionDate = dateOf(latestBar.t);
  const plain = usSessionOf(sessionDate);
  const reg = bench?.regular;
  const session = reg && reg.start === plain.open && reg.end > reg.start ? { open: reg.start, close: reg.end } : plain;
  const marketOpen = opts.now >= session.open && opts.now < session.close && dateOf(opts.now) === sessionDate;

  const assets: AssetSeries[] = [];
  let lastBarEnd = 0;
  for (const s of states) {
    const days = sessions(s.bars);
    const todayIdx = days.findIndex(d => d.date === sessionDate);
    if (todayIdx < 0) continue; // no trading in this session (halted, newly listed, or not loaded yet)
    const today = days[todayIdx];
    const prior = days.slice(0, todayIdx);
    if (!prior.length) continue; // need a previous close to measure the day from
    const prevSession = prior[prior.length - 1];
    const prevClose = s.officialPrev?.date === sessionDate ? s.officialPrev.close : prevSession.bars[prevSession.bars.length - 1].c;

    const avgSlotVol = new Array<number>(SESSION_SLOTS).fill(0);
    const counts = new Array<number>(SESSION_SLOTS).fill(0);
    for (const day of prior.slice(-PRIOR_SESSIONS_FOR_VOLUME)) {
      const open = usSessionOf(day.date).open;
      for (const c of day.bars) {
        const slot = Math.round((c.t - open) / BAR);
        if (slot < 0 || slot >= SESSION_SLOTS) continue;
        avgSlotVol[slot] += c.v;
        counts[slot]++;
      }
    }
    for (let i = 0; i < SESSION_SLOTS; i++) avgSlotVol[i] = counts[i] ? Math.round(avgSlotVol[i] / counts[i]) : 0;

    // Finish the last bar at the official price when it belongs to that bar (or the closing auction right after it).
    let todayBars = today.bars;
    const last = todayBars[todayBars.length - 1];
    const lp = s.lastPrice;
    if (lp && lp.price > 0 && lp.t >= last.t && lp.t <= last.t + BAR + 2 * 60_000 && Math.abs(lp.price / last.c - 1) < 0.1) {
      todayBars = [...todayBars.slice(0, -1), { ...last, c: lp.price, h: Math.max(last.h, lp.price), l: Math.min(last.l, lp.price) }];
    }

    lastBarEnd = Math.max(lastBarEnd, last.t + BAR);
    assets.push({
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      group: s.group,
      candles: [...prevSession.bars, ...todayBars].map(tidy),
      prevClose,
      avgSlotVol,
      options: s.options ? { callVol: s.options.callVol, putVol: s.options.putVol, strikes: s.options.strikes } : null,
    });
  }
  if (!assets.length) return null;
  return {
    market: 'us',
    source: opts.source,
    note: opts.note,
    live: marketOpen,
    marketOpen,
    asOf: Math.min(lastBarEnd, session.close, Math.max(opts.now, session.open)),
    session,
    sessionDate,
    benchmark: opts.benchmark,
    assets,
  };
}
