/** One 5-minute bar. `tb` is the volume bought by aggressive buyers (taker buy), where the venue reports it. */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  tb?: number;
}

/** Open interest at a moment, in contracts / base units (what the % change is read from). */
export interface OIPoint {
  t: number;
  oi: number;
}

/** Open interest by strike: [strike, call OI, put OI]. */
export type StrikeRow = [number, number, number];

export interface OptionsBook {
  /** Contracts traded today, calls and puts. Null when the source has no volume. */
  callVol: number | null;
  putVol: number | null;
  strikes: StrikeRow[];
}

export interface AssetSeries {
  symbol: string;
  /** Exchange symbol, when it differs from the display symbol (e.g. 1000PEPEUSDT). */
  venueSymbol?: string;
  name: string;
  sector: string;
  candles: Candle[];
  /** Crypto: perpetual open interest through the session. */
  oi?: OIPoint[];
  /** Crypto: the latest open interest in USD. */
  oiUsd?: number | null;
  /** Crypto: the latest funding rate, as a fraction per interval. */
  funding?: number | null;
  /** US: the previous session's close. */
  prevClose?: number | null;
  /** US: the average volume of each 5-minute slot of the session over prior days, slot 0 = the open. */
  avgSlotVol?: number[];
  options?: OptionsBook | null;
  /** US: which list the name belongs to (the S&P 500, an index ETF, or a popular name outside the index). */
  group?: 'sp500' | 'etf' | 'popular';
}

export type MarketId = 'crypto' | 'us';

export interface MarketData {
  market: MarketId;
  /** Shown in the status line: "Binance perps", "Demo session", … */
  source: string;
  /** true while the data follows the clock; false for a replay or a saved session. */
  live: boolean;
  /** e.g. "15-min delayed" */
  note?: string;
  asOf: number;
  /** US: the session open and close, epoch ms. */
  session?: { open: number; close: number };
  /** US: the New York date of the session shown (YYYY-MM-DD). */
  sessionDate?: string;
  /** US: true while the regular session is open. */
  marketOpen?: boolean;
  benchmark: string;
  assets: AssetSeries[];
}
