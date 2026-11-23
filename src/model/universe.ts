import type { MarketData, MarketId } from '../data/types';

/**
 * Which names are on the board. US lists are ranked by today's traded value
 * (price × volume), so "Top 50" is always the 50 busiest stocks of the session.
 * Crypto lists follow the venue's 24h volume ranking.
 */
export type UniverseId = 'top50' | 'top100' | 'sp500' | 'all' | 'top20' | 'top40' | 'top80';

export interface UniverseDef {
  id: UniverseId;
  label: string;
  hint: string;
}

export const UNIVERSES: Record<MarketId, UniverseDef[]> = {
  us: [
    { id: 'top50', label: 'Top 50', hint: 'the 50 most-traded names today' },
    { id: 'top100', label: 'Top 100', hint: 'the 100 most-traded names today' },
    { id: 'sp500', label: 'S&P 500', hint: 'every S&P 500 stock plus the index ETFs' },
    { id: 'all', label: 'All', hint: 'the S&P 500 plus popular names outside it' },
  ],
  crypto: [
    { id: 'top20', label: 'Top 20', hint: 'the 20 most-traded perpetuals' },
    { id: 'top40', label: 'Top 40', hint: 'the 40 most-traded perpetuals' },
    { id: 'top80', label: 'Top 80', hint: 'the 80 most-traded perpetuals' },
  ],
};

export const DEFAULT_UNIVERSE: Record<MarketId, UniverseId> = { us: 'sp500', crypto: 'top40' };

export const universeDef = (market: MarketId, id: string | null | undefined): UniverseDef =>
  UNIVERSES[market].find(u => u.id === id) ?? UNIVERSES[market].find(u => u.id === DEFAULT_UNIVERSE[market])!;

/** Traded value of the session shown (US) or of the whole series (crypto). */
export function tradedValue(data: MarketData, symbol: string): number {
  const a = data.assets.find(x => x.symbol === symbol);
  if (!a) return 0;
  const from = data.session?.open ?? 0;
  let sum = 0;
  for (const c of a.candles) if (c.t >= from) sum += c.c * c.v;
  return sum;
}

/** The symbols in a universe. The benchmark is always included. */
export function selectUniverse(data: MarketData, id: UniverseId): Set<string> {
  const def = universeDef(data.market, id);
  const top = (n: number) => {
    if (data.market === 'crypto') return data.assets.slice(0, n).map(a => a.symbol); // already in volume order
    const from = data.session?.open ?? 0;
    const value = new Map<string, number>();
    for (const a of data.assets) {
      let sum = 0;
      for (const c of a.candles) if (c.t >= from) sum += c.c * c.v;
      value.set(a.symbol, sum);
    }
    return [...data.assets].sort((x, y) => value.get(y.symbol)! - value.get(x.symbol)!).slice(0, n).map(a => a.symbol);
  };
  let symbols: string[];
  switch (def.id) {
    case 'top20': symbols = top(20); break;
    case 'top40': symbols = top(40); break;
    case 'top80': symbols = top(80); break;
    case 'top50': symbols = top(50); break;
    case 'top100': symbols = top(100); break;
    case 'sp500': symbols = data.assets.filter(a => a.group !== 'popular').map(a => a.symbol); break;
    default: symbols = data.assets.map(a => a.symbol);
  }
  const set = new Set(symbols);
  set.add(data.benchmark);
  return set;
}
