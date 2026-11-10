#!/usr/bin/env node
/**
 * Builds public/data/us.json: the US board's market file.
 *
 *   node scripts/build-us-data.mjs [outfile]
 *
 * For every name in src/data/universe.ts (US_ASSETS):
 *   - 5-minute bars for the last few sessions (Yahoo Finance chart API)
 *   - the previous session's close
 *   - the usual volume of each 5-minute slot over the prior sessions (relative volume)
 *   - option open interest by strike for expiries in the next 35 days, and today's
 *     call and put volume (Cboe's delayed quotes)
 *
 * Run it whenever you want a fresh US session; the page reads the file it writes.
 * Data is delayed and for information only;
 * check the providers' terms before using it for anything else.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'public/data/us.json');
const UA = 'Mozilla/5.0 (compatible; flow-board/1.0; +https://github.com/)';
const BAR = 5 * 60_000;
const SLOTS = 78;

async function universe() {
  const src = await readFile(resolve(root, 'src/data/universe.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const US_ASSETS'));
  const rows = [...block.matchAll(/\['([A-Z.]+)', '((?:[^'\\]|\\.)*)', '([a-z]+)'\]/g)];
  return rows.map(m => ({ symbol: m[1], name: m[2].replace(/\\u2019/g, '’'), sector: m[3] }));
}

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

async function pool(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await task(items[i]); }
  }));
  return out;
}

/** Yahoo: 5-minute bars over 5 sessions, regular hours only. */
async function bars(symbol) {
  const json = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=5d&includePrePost=false`);
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`no bars for ${symbol}`);
  const q = r.indicators.quote[0];
  const candles = [];
  r.timestamp.forEach((ts, i) => {
    const c = q.close[i];
    if (c == null) return;
    candles.push({ t: ts * 1000, o: q.open[i] ?? c, h: q.high[i] ?? c, l: q.low[i] ?? c, c, v: q.volume[i] ?? 0 });
  });
  return { candles };
}

/** Cboe delayed quotes: option OI by strike (next 35 days) and today's call/put volume. */
async function options(symbol) {
  const json = await getJson(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(symbol)}.json`, 2);
  const list = json?.data?.options ?? [];
  const now = Date.now();
  const byStrike = new Map();
  let callVol = 0;
  let putVol = 0;
  for (const o of list) {
    // OCC symbol: ROOT + YYMMDD + C/P + strike*1000 (8 digits)
    const m = /^([A-Z.]+?)(\d{6})([CP])(\d{8})$/.exec(o.option);
    if (!m) continue;
    const expiry = Date.UTC(2000 + +m[2].slice(0, 2), +m[2].slice(2, 4) - 1, +m[2].slice(4, 6), 21);
    const strike = +m[4] / 1000;
    if (m[3] === 'C') callVol += o.volume ?? 0; else putVol += o.volume ?? 0;
    if (expiry < now || expiry > now + 35 * 86400_000) continue;
    const row = byStrike.get(strike) ?? [strike, 0, 0];
    if (m[3] === 'C') row[1] += o.open_interest ?? 0; else row[2] += o.open_interest ?? 0;
    byStrike.set(strike, row);
  }
  const spot = json?.data?.current_price ?? json?.data?.close ?? null;
  let strikes = [...byStrike.values()].sort((a, b) => a[0] - b[0]);
  if (spot) {
    const below = strikes.filter(r => r[0] <= spot).slice(-20);
    const above = strikes.filter(r => r[0] > spot).slice(0, 20);
    strikes = [...below, ...above];
  }
  return { callVol, putVol, strikes };
}

function sessions(candles) {
  const byDay = new Map();
  for (const c of candles) {
    const day = new Date(c.t - 4 * 3600_000).toISOString().slice(0, 10); // ET date (good enough to group a session)
    (byDay.get(day) ?? byDay.set(day, []).get(day)).push(c);
  }
  return [...byDay.values()];
}

async function main() {
  const names = await universe();
  console.log(`building US file for ${names.length} names → ${out}`);
  let session = null;
  const assets = (await pool(names, 6, async ({ symbol, name, sector }) => {
    try {
      const { candles } = await bars(symbol);
      const days = sessions(candles);
      const today = days.at(-1);
      const prior = days.slice(0, -1);
      if (!today?.length || !prior.length) throw new Error('not enough sessions');
      const open = today[0].t;
      if (!session || open > session.open) session = { open, close: open + SLOTS * BAR };
      const prevClose = prior.at(-1).at(-1).c;
      const avgSlotVol = Array.from({ length: SLOTS }, (_, slot) => {
        let s = 0, n = 0;
        for (const day of prior) {
          const c = day.find(x => Math.round((x.t - day[0].t) / BAR) === slot);
          if (c) { s += c.v; n++; }
        }
        return n ? Math.round(s / n) : 0;
      });
      let opts = null;
      try { opts = await options(symbol); } catch (e) { console.warn(`  options ${symbol}: ${e.message}`); }
      const round = x => +x.toPrecision(7);
      return {
        symbol, name, sector, prevClose,
        candles: candles.slice(-SLOTS * 3).map(c => ({ t: c.t, o: round(c.o), h: round(c.h), l: round(c.l), c: round(c.c), v: c.v })),
        avgSlotVol,
        options: opts,
      };
    } catch (e) {
      console.warn(`  skip ${symbol}: ${e.message}`);
      return null;
    }
  })).filter(Boolean);

  if (assets.length < 10 || !session) throw new Error(`only ${assets.length} names built; keeping the previous file`);
  const lastBar = Math.max(...assets.map(a => a.candles.at(-1).t));
  const data = {
    market: 'us',
    source: 'US stocks',
    live: Date.now() < session.close + 15 * 60_000,
    note: 'delayed · Yahoo Finance bars, Cboe options',
    asOf: Math.min(lastBar + BAR, session.close),
    builtAt: Date.now(),
    session,
    benchmark: 'SPY',
    assets,
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(data));
  console.log(`wrote ${assets.length} names, session ${new Date(session.open).toISOString()}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
