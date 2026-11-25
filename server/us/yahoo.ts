import type { Candle } from '../../src/data/types';
import { getJson, type RequestStats } from '../http';
import { yahooSymbol } from './sp500';

/**
 * 5-minute bars from Yahoo Finance's public chart endpoint (no key needed).
 * Regular hours only. Yahoo is free and unofficial: fine for a personal board,
 * not a licensed data feed.
 */
const BAR = 5 * 60_000;

export interface YahooSeries {
  candles: Candle[];
  /** The official close of the session before the range (Yahoo's chartPreviousClose). */
  chartPreviousClose: number | null;
  /** Today's regular session as Yahoo reports it (handles half days). */
  regular: { start: number; end: number } | null;
  /** Yahoo's official latest price (after the close: the closing auction) and its time. */
  marketPrice: number | null;
  marketTime: number | null;
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: {
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketPrice?: number;
        regularMarketTime?: number;
        currentTradingPeriod?: { regular?: { start: number; end: number } };
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export function parseYahooChart(json: YahooChart): YahooSeries {
  const r = json.chart?.result?.[0];
  if (!r) throw new Error(json.chart?.error?.description ?? 'no chart data');
  const q = r.indicators?.quote?.[0] ?? {};
  const ts = r.timestamp ?? [];
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null || !Number.isFinite(c)) continue;
    const t = Math.floor((ts[i] * 1000) / BAR) * BAR;
    const bar: Candle = {
      t,
      o: q.open?.[i] ?? c,
      h: q.high?.[i] ?? c,
      l: q.low?.[i] ?? c,
      c,
      v: q.volume?.[i] ?? 0,
    };
    const prev = candles[candles.length - 1];
    if (prev && prev.t === t) {
      // Yahoo sometimes appends a live tick inside the last bar: fold it in.
      prev.h = Math.max(prev.h, bar.h);
      prev.l = Math.min(prev.l, bar.l);
      prev.c = bar.c;
      prev.v += bar.v;
    } else if (!prev || t > prev.t) {
      candles.push(bar);
    }
  }
  const reg = r.meta?.currentTradingPeriod?.regular;
  return {
    candles,
    chartPreviousClose: r.meta?.chartPreviousClose ?? r.meta?.previousClose ?? null,
    regular: reg ? { start: reg.start * 1000, end: reg.end * 1000 } : null,
    marketPrice: r.meta?.regularMarketPrice ?? null,
    marketTime: r.meta?.regularMarketTime ? r.meta.regularMarketTime * 1000 : null,
  };
}

export async function fetchYahoo(symbol: string, range: '1d' | '5d', stats?: RequestStats): Promise<YahooSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?interval=5m&range=${range}&includePrePost=false`;
  return parseYahooChart(await getJson<YahooChart>(url, { stats, retries: 3 }));
}
