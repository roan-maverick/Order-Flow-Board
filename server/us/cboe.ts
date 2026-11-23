import type { OptionsBook, StrikeRow } from '../../src/data/types';
import { getJson, type RequestStats } from '../http';

/**
 * Listed option open interest by strike and today's call/put volume, from
 * Cboe's free delayed quotes. Open interest is published once a day, so a
 * chain only needs fetching about once a day; volume moves during the day.
 */
const DAY = 86_400_000;
export const OPTION_DAYS = 35; // expiries counted for the walls
const STRIKES_EACH_SIDE = 15;

interface CboeChain {
  data?: {
    current_price?: number;
    close?: number;
    options?: Array<{ option: string; open_interest?: number; volume?: number }>;
  };
}

/** Cboe writes class shares without the dot: BRK.B → BRKB. Indexes have no options here. */
export const cboeSymbol = (symbol: string) => symbol.replace(/\./g, '');

/** OCC symbol: ROOT + YYMMDD + C/P + strike × 1000 (8 digits). */
export function parseOcc(occ: string): { root: string; expiry: number; side: 'C' | 'P'; strike: number } | null {
  const m = /^([A-Z][A-Z0-9.]*?)(\d{6})([CP])(\d{8})$/.exec(occ);
  if (!m) return null;
  const d = m[2];
  // 16:00 New York ≈ 21:00 UTC; precise enough for a 35-day cut-off
  return { root: m[1], expiry: Date.UTC(2000 + +d.slice(0, 2), +d.slice(2, 4) - 1, +d.slice(4, 6), 21), side: m[3] as 'C' | 'P', strike: +m[4] / 1000 };
}

/** `root`: only count the standard series of this symbol (skips adjusted roots like AAPL1). */
export function parseCboeChain(json: CboeChain, now: number, root?: string): OptionsBook & { spot: number | null } {
  const list = json.data?.options ?? [];
  const byStrike = new Map<number, StrikeRow>();
  let callVol = 0;
  let putVol = 0;
  for (const o of list) {
    const p = parseOcc(o.option);
    if (!p || p.expiry < now - DAY || (root && p.root !== root)) continue;
    if (p.side === 'C') callVol += o.volume ?? 0; else putVol += o.volume ?? 0;
    if (p.expiry > now + OPTION_DAYS * DAY) continue;
    const row = byStrike.get(p.strike) ?? [p.strike, 0, 0];
    if (p.side === 'C') row[1] += o.open_interest ?? 0; else row[2] += o.open_interest ?? 0;
    byStrike.set(p.strike, row);
  }
  const spot = json.data?.current_price ?? json.data?.close ?? null;
  let strikes = [...byStrike.values()].filter(r => r[1] + r[2] > 0).sort((a, b) => a[0] - b[0]);
  if (spot) {
    strikes = [...strikes.filter(r => r[0] <= spot).slice(-STRIKES_EACH_SIDE), ...strikes.filter(r => r[0] > spot).slice(0, STRIKES_EACH_SIDE)];
  }
  return { callVol, putVol, strikes, spot };
}

// Cboe's CDN only serves requests that look like its own web page asking.
const CBOE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  referer: 'https://www.cboe.com/',
  origin: 'https://www.cboe.com',
};

export async function fetchCboe(symbol: string, now: number, stats?: RequestStats) {
  const root = cboeSymbol(symbol);
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(root)}.json`;
  return parseCboeChain(await getJson<CboeChain>(url, { stats, retries: 1, timeoutMs: 30_000, headers: CBOE_HEADERS }), now, root);
}
