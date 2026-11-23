#!/usr/bin/env node
/**
 * A paper-trading bot built on the board. It uses fake money only and
 * places no real orders.
 *
 * It shows the whole loop of a simple trading system, so you can change the
 * rules and watch what happens before you ever risk money:
 *
 *   1. Every few minutes, ask the board for its strongest setups.
 *   2. "Enter" a paper trade on new ones: long the bullish names, short the
 *      bearish ones. The stop sits at the board's support (longs) or
 *      resistance (shorts); the target is twice the risk.
 *   3. Check open trades on every round: close them at the stop, the target,
 *      or the end of the session.
 *   4. Log every trade to paper-trades.csv and print the running score.
 *
 * Run it (with the board already running via npm start):
 *
 *   node examples/paper-bot.mjs              US stocks
 *   node examples/paper-bot.mjs crypto       crypto perpetuals
 *
 * Settings (environment variables): FLOW_URL, EVERY_MINUTES (default 5),
 * MIN_CHECKS (default 4), MAX_OPEN (default 5), RISK_USD (default 100 per trade).
 *
 * Nothing here is investment advice, and a rule that looks good on paper
 * can still lose money live. Test for weeks, on paper, before anything else.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const MARKET = process.argv[2] === 'crypto' ? 'crypto' : 'us';
const BASE = (process.env.FLOW_URL ?? 'http://127.0.0.1:5199').replace(/\/$/, '');
const EVERY = Number(process.env.EVERY_MINUTES ?? 5) * 60_000;
const MIN_CHECKS = Number(process.env.MIN_CHECKS ?? 4);
const MAX_OPEN = Number(process.env.MAX_OPEN ?? 5);
const RISK_USD = Number(process.env.RISK_USD ?? 100);
const REWARD_TO_RISK = 2;
const STATE = `paper-state-${MARKET}.json`;
const LOG = 'paper-trades.csv';

const get = async path => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const state = existsSync(STATE) ? JSON.parse(await readFile(STATE, 'utf8')) : { open: [], closed: [] };
if (!existsSync(LOG)) await writeFile(LOG, 'closed_at,market,symbol,direction,entry,exit,stop,target,qty,pnl_usd,reason\n');

/** A setup becomes a paper trade only if the board gives it a level to lean on. */
function plan(a) {
  const long = a.side === 'bullish';
  const level = long ? a.support?.price : a.resistance?.price;
  if (!level) return null;
  const risk = long ? a.price - level : level - a.price;
  if (!(risk > 0) || risk / a.price > 0.08) return null; // stop too far: skip
  const target = long ? a.price + risk * REWARD_TO_RISK : a.price - risk * REWARD_TO_RISK;
  return { symbol: a.symbol, direction: long ? 'long' : 'short', entry: a.price, stop: level, target, qty: RISK_USD / risk, openedAt: new Date().toISOString(), why: `${a.buildUp.label}, ${a.conviction.held}/${a.conviction.counted} checks` };
}

async function close(t, price, reason) {
  const pnl = (t.direction === 'long' ? price - t.entry : t.entry - price) * t.qty;
  state.open = state.open.filter(x => x !== t);
  state.closed.push({ ...t, exit: price, pnl, reason, closedAt: new Date().toISOString() });
  await appendFile(LOG, [new Date().toISOString(), MARKET, t.symbol, t.direction, t.entry, price, t.stop, t.target.toFixed(4), t.qty.toFixed(4), pnl.toFixed(2), reason].join(',') + '\n');
  console.log(`  closed ${t.direction} ${t.symbol} at ${price} (${reason}): ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
}

async function round() {
  const board = await get(`/api/flow/${MARKET}?minChecks=${MIN_CHECKS}&fresh=true&limit=40`);
  const time = new Date().toLocaleTimeString();
  console.log(`\n${time}  ${board.counts.bullish} up / ${board.counts.bearish} down · ${board.marketOpen === false ? 'market closed' : 'market open'}`);

  // 1. Manage open trades.
  for (const t of [...state.open]) {
    let a;
    try { a = await get(`/api/flow/${MARKET}/${encodeURIComponent(t.symbol)}`); } catch { continue; }
    const p = a.price;
    const hitStop = t.direction === 'long' ? p <= t.stop : p >= t.stop;
    const hitTarget = t.direction === 'long' ? p >= t.target : p <= t.target;
    if (hitStop) await close(t, t.stop, 'stop');
    else if (hitTarget) await close(t, t.target, 'target');
    else if (MARKET === 'us' && board.marketOpen === false) await close(t, p, 'session end');
  }

  // 2. Open new ones (US: only while the market is open).
  if (MARKET === 'us' && board.marketOpen === false) return;
  const held = new Set(state.open.map(t => t.symbol));
  for (const a of board.results.filter(a => a.side !== 'rangebound' && !a.isBenchmark)) {
    if (state.open.length >= MAX_OPEN) break;
    if (held.has(a.symbol)) continue;
    const t = plan(a);
    if (!t) continue;
    state.open.push(t);
    console.log(`  opened ${t.direction} ${t.symbol} at ${t.entry} · stop ${t.stop} · target ${t.target.toFixed(4)} · ${t.why}`);
  }

  const total = state.closed.reduce((s, t) => s + t.pnl, 0);
  const wins = state.closed.filter(t => t.pnl > 0).length;
  console.log(`  open ${state.open.length} · closed ${state.closed.length} · won ${wins} · paper P&L ${total >= 0 ? '+' : ''}$${total.toFixed(2)}`);
  await writeFile(STATE, JSON.stringify(state, null, 1));
}

console.log(`Paper bot on the ${MARKET === 'us' ? 'US' : 'crypto'} board · every ${EVERY / 60_000} min · min ${MIN_CHECKS} checks · $${RISK_USD} risk per trade. Fake money only. Ctrl+C to stop.`);
const loop = async () => {
  try { await round(); } catch (e) { console.log(`  board not reachable (${e.message}). Is "npm start" running?`); }
  setTimeout(loop, EVERY);
};
loop();
