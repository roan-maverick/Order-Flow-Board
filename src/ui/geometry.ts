import type { Flow, FlowAsset } from '../model/flow';

/**
 * The board is drawn on one fixed canvas (W × H design pixels) and scaled to
 * the screen, so every line lands exactly on its tunnel and its tile.
 *
 *   sectors │ chart (every name from 0%) │ bend │ tunnel │ fan │ tiles · tall tiles · cards
 *                                                 green above the bar, red below
 */
export const W = 1680;
export const H = 900;

export const G = {
  top: 96, // first y of the plot
  bottom: 872, // last y of the plot
  sectorsX: 0,
  sectorsW: 158,
  chartX0: 196,
  chartX1: 700,
  tunnelX0: 770,
  tunnelX1: 856,
  portX: 924,
  tilesX: 932,
  tileW: 104,
  tileH: 54,
  tileGapX: 9,
  tileGapY: 9,
  tallX: 1271,
  tallW: 124,
  cardX: 1405,
  cardW: 275,
  barH: 18,
};

export const MID = (G.top + G.bottom) / 2;
export const HALF_TOP = { bullish: G.top, bearish: MID + G.barH / 2 };
export const HALF_H = MID - G.barH / 2 - G.top;
export const TILE_COLS = 3;
export const TILE_ROWS = Math.floor((HALF_H + G.tileGapY) / (G.tileH + G.tileGapY));
export const TILES_PER_SIDE = TILE_COLS * TILE_ROWS;
export const TALL_PER_SIDE = 2;
export const NAMED_PER_SIDE = 5;

export type Slot = 'card' | 'tall' | 'tile' | 'more';

export interface Placed {
  asset: FlowAsset | null; // null: the "+N more" tile
  slot: Slot;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where its line arrives. */
  portY: number;
  more?: number;
}

export interface SideLayout {
  placed: Placed[];
  /** symbol → its placement (assets folded into "+N more" point at that tile) */
  bySymbol: Map<string, Placed>;
  tunnel: { y0: number; y1: number };
}

/**
 * Sorts a side onto cards (the strongest readings), tall tiles (the next
 * strongest, with their open-interest profile) and tiles (the rest, by the
 * size of the move). Bulls fill from the top, bears from the bottom, so the
 * strongest readings sit furthest from the zero line.
 */
export function layoutSide(flow: Flow, side: 'bullish' | 'bearish'): SideLayout {
  const list = flow[side];
  const cards = flow.featured[side];
  const cardSet = new Set(cards.map(a => a.symbol));
  const tall = [...list].filter(a => !cardSet.has(a.symbol) && !a.isBenchmark).sort((a, b) => b.strength - a.strength).slice(0, TALL_PER_SIDE);
  const tallSet = new Set(tall.map(a => a.symbol));
  const rest = list.filter(a => !cardSet.has(a.symbol) && !tallSet.has(a.symbol));

  const top = HALF_TOP[side];
  const flip = (y: number, h: number) => (side === 'bullish' ? y : top + HALF_H - (y - top) - h);
  const placed: Placed[] = [];

  const cardGap = 10;
  const cardH = (HALF_H - cardGap * 2) / 3;
  cards.forEach((asset, i) => {
    const y = flip(top + i * (cardH + cardGap), cardH);
    placed.push({ asset, slot: 'card', x: G.cardX, y, w: G.cardW, h: cardH, portY: 0 });
  });

  const tallGap = 10;
  const tallH = (HALF_H - tallGap) / 2;
  tall.forEach((asset, i) => {
    const y = flip(top + i * (tallH + tallGap), tallH);
    placed.push({ asset, slot: 'tall', x: G.tallX, y, w: G.tallW, h: tallH, portY: 0 });
  });

  const overflow = rest.length > TILES_PER_SIDE ? rest.length - (TILES_PER_SIDE - 1) : 0;
  const shown = overflow ? rest.slice(0, TILES_PER_SIDE - 1) : rest;
  const bySymbol = new Map<string, Placed>();
  shown.forEach((asset, i) => {
    const row = Math.floor(i / TILE_COLS);
    const col = i % TILE_COLS;
    const y = flip(top + row * (G.tileH + G.tileGapY), G.tileH);
    placed.push({ asset, slot: 'tile', x: G.tilesX + col * (G.tileW + G.tileGapX), y, w: G.tileW, h: G.tileH, portY: 0 });
  });
  if (overflow) {
    const i = TILES_PER_SIDE - 1;
    const row = Math.floor(i / TILE_COLS);
    const col = i % TILE_COLS;
    const y = flip(top + row * (G.tileH + G.tileGapY), G.tileH);
    const more: Placed = { asset: null, slot: 'more', x: G.tilesX + col * (G.tileW + G.tileGapX), y, w: G.tileW, h: G.tileH, portY: 0, more: overflow };
    placed.push(more);
    for (const a of rest.slice(TILES_PER_SIDE - 1)) bySymbol.set(a.symbol, more);
  }

  // Ports: each line arrives at the grid's left edge level with the element it
  // feeds; elements sharing a row are fanned a few pixels apart.
  const elementPort = (p: Placed) => {
    const cy = p.y + p.h / 2;
    if (p.slot === 'tile' || p.slot === 'more') return cy + (Math.round((p.x - G.tilesX) / (G.tileW + G.tileGapX)) - 1) * 9;
    return cy + (p.slot === 'tall' ? -5 : 5);
  };
  for (const p of placed) p.portY = elementPort(p);
  const more = placed.find(p => p.slot === 'more');
  for (const a of list) {
    const p = placed.find(x => x.asset?.symbol === a.symbol);
    if (p) bySymbol.set(a.symbol, p);
  }
  if (more) {
    const folded = list.filter(a => bySymbol.get(a.symbol) === more);
    folded.forEach((a, i) => bySymbol.set(a.symbol, { ...more, portY: more.portY - 8 + (16 * (i + 0.5)) / folded.length }));
  }
  const n = list.length;

  const tunnelH = Math.min(HALF_H * 0.42, 14 + n * 2.6);
  const tc = top + HALF_H * (side === 'bullish' ? 0.5 : 0.5);
  return { placed, bySymbol, tunnel: { y0: tc - tunnelH / 2, y1: tc + tunnelH / 2 } };
}


/** The y-scale of the chart: ±max move, with a little headroom, at least ±3× the window floor. */
export function chartScale(flow: Flow) {
  let max = flow.window.floor * 3;
  for (const a of flow.assets) for (const p of a.points) max = Math.max(max, Math.abs(p.pct));
  max *= 1.06;
  const half = MID - G.top - 6;
  const y = (pct: number) => MID - (pct / max) * half;
  const step = niceStep(max / 3);
  const ticks: number[] = [];
  for (let v = -Math.floor(max / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return { max, y, ticks };
}

export function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
}

export const timeX = (flow: Flow, t: number) =>
  G.chartX0 + ((t - flow.start) / Math.max(1, flow.end - flow.start)) * (G.chartX1 - G.chartX0);

/** Simplifies a long series to at most `max` points, keeping each bucket's last point and extremes. */
export function thin<T extends { pct: number }>(points: T[], max = 160): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [points[0]];
  for (let i = 1; i < max; i++) {
    const from = Math.floor(i * step);
    const to = Math.min(points.length, Math.floor((i + 1) * step));
    let pick = points[to - 1];
    for (let j = from; j < to; j++) if (Math.abs(points[j].pct) > Math.abs(pick.pct) * 1.002) pick = points[j];
    out.push(pick);
  }
  out.push(points[points.length - 1]);
  return out;
}
