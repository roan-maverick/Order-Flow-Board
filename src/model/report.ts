import type { BuildUpCode, Flow, FlowAsset, Side } from './flow';

/**
 * The board as data: a compact JSON shape for bots and the API, and a plain
 * text brief for pasting into an AI chat (or handing to an AI agent).
 */

export interface Filters {
  side?: Side;
  minChecks?: number;
  buildUp?: BuildUpCode[];
  sector?: string;
  limit?: number;
  /** Only names whose build-up has fresh participation behind it. */
  fresh?: boolean;
}

const round = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const roundPrice = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : +v.toPrecision(6));

export function assetJson(a: FlowAsset, withCandles = false) {
  return {
    symbol: a.symbol,
    name: a.name,
    sector: a.sectorLabel,
    side: a.side,
    rank: a.rank,
    changePct: round(a.changePct),
    price: roundPrice(a.price),
    from: roundPrice(a.base),
    buildUp: { code: a.buildUp.code, label: a.buildUp.label, fresh: a.buildUp.fresh },
    conviction: { held: a.checksHeld, counted: a.checksCounted, checks: a.checks.map(c => ({ id: c.id, label: c.label, pass: c.pass, note: c.note })) },
    strength: round(a.strength, 3),
    support: a.support ? { price: roundPrice(a.support.price), distancePct: round(a.support.distancePct), kind: a.support.kind } : null,
    resistance: a.resistance ? { price: roundPrice(a.resistance.price), distancePct: round(a.resistance.distancePct), kind: a.resistance.kind } : null,
    zone: a.zone ? { low: roundPrice(a.zone.low), high: roundPrice(a.zone.high), from: new Date(a.zone.from).toISOString(), to: new Date(a.zone.to).toISOString() } : null,
    openInterestChangePct: round(a.oiChangePct),
    openInterestUsd: round(a.oiValue, 0),
    fundingRatePct: a.funding == null ? null : round(a.funding * 100, 4),
    takerBuyPct: a.takerBuyShare == null ? null : round(a.takerBuyShare * 100, 1),
    relativeVolume: round(a.rvol),
    callPutVolumeRatio: round(a.callPutRatio),
    isBenchmark: a.isBenchmark,
    ...(withCandles ? { candles: a.candles.map(c => [c.t, roundPrice(c.o), roundPrice(c.h), roundPrice(c.l), roundPrice(c.c), Math.round(c.v)]) } : {}),
  };
}

export function applyFilters(list: FlowAsset[], f: Filters): FlowAsset[] {
  let out = list;
  if (f.side) out = out.filter(a => a.side === f.side);
  if (f.minChecks != null) out = out.filter(a => a.checksHeld >= f.minChecks!);
  if (f.buildUp?.length) out = out.filter(a => f.buildUp!.includes(a.buildUp.code));
  if (f.fresh) out = out.filter(a => a.buildUp.fresh);
  if (f.sector) {
    const s = f.sector.toLowerCase();
    out = out.filter(a => a.sectorLabel.toLowerCase().includes(s) || a.sector.toLowerCase() === s);
  }
  return f.limit != null ? out.slice(0, f.limit) : out;
}

export interface BoardMeta {
  universe: string;
  marketOpen?: boolean;
  sessionDate?: string;
}

export function boardJson(flow: Flow, meta: BoardMeta, filters: Filters = {}) {
  const hasFilters = Object.values(filters).some(v => v != null && !(Array.isArray(v) && !v.length));
  const strongest = (list: FlowAsset[]) => [...list].sort((a, b) => b.strength - a.strength);
  return {
    market: flow.market,
    window: flow.window.id,
    windowMeaning: flow.window.scope,
    universe: meta.universe,
    asOf: new Date(flow.asOf).toISOString(),
    marketOpen: meta.marketOpen ?? null,
    sessionDate: meta.sessionDate ?? null,
    source: flow.source,
    live: flow.live,
    benchmark: flow.benchmark ? { symbol: flow.benchmark.symbol, changePct: round(flow.benchmark.changePct) } : null,
    counts: { bullish: flow.bullish.length, bearish: flow.bearish.length, rangebound: flow.rangebound.length, total: flow.assets.length },
    sectors: flow.sectors.map(s => ({ name: s.label, changePct: round(s.changePct), lean: s.lean, up: s.bullish, flat: s.rangebound, down: s.bearish })),
    ...(hasFilters
      ? { results: applyFilters(strongest(flow.assets.filter(a => !a.isBenchmark)), filters).map(a => assetJson(a)) }
      : {
          strongest: { bullish: flow.featured.bullish.map(a => assetJson(a)), bearish: flow.featured.bearish.map(a => assetJson(a)) },
          bullish: flow.bullish.map(a => assetJson(a)),
          bearish: flow.bearish.map(a => assetJson(a)),
          rangebound: flow.rangebound.map(a => ({ symbol: a.symbol, changePct: round(a.changePct) })),
        }),
    disclaimer: 'Market readings for information only. Not investment advice.',
  };
}

const pct = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const px = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'n/a' : `${+v.toPrecision(6)}`);

function line(a: FlowAsset): string {
  const lv = `S ${a.support ? px(a.support.price) : 'n/a'} / R ${a.resistance ? px(a.resistance.price) : 'n/a'}`;
  const extra = a.oiChangePct != null ? `OI ${pct(a.oiChangePct)}` : a.rvol != null ? `RVOL ${a.rvol.toFixed(2)}x` : '';
  return `${a.symbol.padEnd(6)} ${pct(a.changePct).padStart(8)}  ${a.buildUp.label}; ${a.checksHeld}/${a.checksCounted} checks; ${extra}; ${lv} (${a.sectorLabel})`;
}

/** A plain-text brief of the board, for pasting into an AI chat. */
export function boardText(flow: Flow, meta: BoardMeta, top = 10): string {
  const out: string[] = [];
  const when = new Date(flow.asOf).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  out.push(`GLOBAL ORDER FLOW: ${flow.market === 'us' ? 'US STOCKS' : 'CRYPTO PERPETUALS'} (${meta.universe}, ${flow.window.label} window, ${flow.window.scope})`);
  out.push(`As of ${when}${meta.marketOpen === false ? ' (market closed: last session)' : ''}. Source: ${flow.source}.`);
  out.push(`Breadth: ${flow.bullish.length} bullish, ${flow.rangebound.length} flat, ${flow.bearish.length} bearish of ${flow.assets.length}. Benchmark ${flow.benchmark?.symbol ?? 'n/a'} ${pct(flow.benchmark?.changePct)}.`);
  out.push('');
  out.push('SECTORS (median move):');
  for (const s of flow.sectors) out.push(`  ${s.label.padEnd(20)} ${pct(s.changePct).padStart(8)}  up ${s.bullish} / flat ${s.rangebound} / down ${s.bearish}`);
  const strongest = (list: FlowAsset[]) => [...list].filter(a => !a.isBenchmark).sort((a, b) => b.strength - a.strength).slice(0, top);
  out.push('');
  out.push(`STRONGEST BULLISH (move + participation + checks):`);
  for (const a of strongest(flow.bullish)) out.push('  ' + line(a));
  out.push('');
  out.push(`STRONGEST BEARISH:`);
  for (const a of strongest(flow.bearish)) out.push('  ' + line(a));
  out.push('');
  out.push(flow.market === 'crypto'
    ? 'Key: build-up reads price against open interest (long build-up = price up + OI up; short covering = up + OI down; short build-up = down + OI up; long unwinding = down + OI down). S/R = support/resistance from option walls (BTC, ETH) or volume shelves.'
    : 'Key: build-up reads price against relative volume (RVOL = volume vs its usual pace for the time of day). S/R = put wall / call wall from listed option open interest, or volume shelves. Checks: participation, shorter window agrees, options or aggressor flow, benchmark agrees, sector agrees.');
  out.push('Readings for information only, not investment advice.');
  return out.join('\n');
}

export function assetText(a: FlowAsset, flow: Flow): string {
  const out: string[] = [];
  out.push(`${a.symbol} (${a.name}, ${a.sectorLabel}): ${pct(a.changePct)} ${flow.window.scope}, price ${px(a.price)}.`);
  out.push(`Side: ${a.side}${a.rank ? `, rank #${a.rank}` : ''}. Build-up: ${a.buildUp.label}. Conviction: ${a.checksHeld} of ${a.checksCounted} checks hold.`);
  for (const c of a.checks) out.push(`  [${c.pass == null ? '-' : c.pass ? 'x' : ' '}] ${c.label}: ${c.note}`);
  out.push(`Support: ${a.support ? `${px(a.support.price)} (${pct(a.support.distancePct)}, ${a.support.kind === 'options' ? 'put wall' : 'volume shelf'})` : 'n/a'}. Resistance: ${a.resistance ? `${px(a.resistance.price)} (${pct(a.resistance.distancePct)}, ${a.resistance.kind === 'options' ? 'call wall' : 'volume shelf'})` : 'n/a'}.`);
  if (a.zone) out.push(`Zone where participation was added: ${px(a.zone.low)} to ${px(a.zone.high)}.`);
  if (a.oiChangePct != null) out.push(`Open interest ${pct(a.oiChangePct)}${a.funding != null ? `, funding ${(a.funding * 100).toFixed(4)}%` : ''}${a.takerBuyShare != null ? `, taker buys ${(a.takerBuyShare * 100).toFixed(1)}%` : ''}.`);
  if (a.rvol != null) out.push(`Relative volume ${a.rvol.toFixed(2)}x${a.callPutRatio != null ? `, call/put volume ${a.callPutRatio.toFixed(2)}` : ''}.`);
  return out.join('\n');
}
