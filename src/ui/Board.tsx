import type React from 'react';
import { memo, useMemo } from 'react';
import type { Flow, FlowAsset } from '../model/flow';
import { G, H, MID, NAMED_PER_SIDE, W, chartScale, layoutSide, thin, timeX, type Placed, type SideLayout } from './geometry';
import { Candles } from './Candles';
import { clock, price, shortPrice, SHORT_BUILDUP, signedPct, signedPrice } from './format';
import { FONT, MONO, sideColor, sideInk } from './palette';
import { usePalette } from './usePalette';

interface Props {
  flow: Flow;
  hot: string | null; // hovered or pinned symbol
  hotSector: string | null;
  onHover: (symbol: string | null) => void;
  onHoverSector: (sector: string | null) => void;
  onPick: (symbol: string) => void;
  timeZone?: string;
}

const sideClass = (a: FlowAsset) => (a.side === 'bullish' ? 'bull' : a.side === 'bearish' ? 'bear' : 'flat');

export function Board({ flow, hot, hotSector, onHover, onHoverSector, onPick, timeZone }: Props) {
  const scale = useMemo(() => chartScale(flow), [flow]);
  const bull = useMemo(() => layoutSide(flow, 'bullish'), [flow]);
  const bear = useMemo(() => layoutSide(flow, 'bearish'), [flow]);
  const sectorMembers = useMemo(() => new Set(hotSector ? flow.sectors.find(s => s.id === hotSector)?.symbols ?? [] : []), [flow, hotSector]);
  const focus = hot ? new Set([hot]) : hotSector ? sectorMembers : null;
  const maxMove = Math.max(1e-9, ...flow.assets.map(a => Math.abs(a.changePct)));

  return (
    <div className={`canvas${focus ? ' focusing' : ''}`} style={{ width: W, height: H }}>
      <Status flow={flow} timeZone={timeZone} />
      <Spread flow={flow} max={scale.max} focus={focus} onHover={onHover} onPick={onPick} />
      <Sectors flow={flow} hotSector={hotSector} onHoverSector={onHoverSector} />
      <Lines flow={flow} scale={scale} bull={bull} bear={bear} focus={focus} timeZone={timeZone} />
      <Bar flow={flow} focus={focus} onHover={onHover} onPick={onPick} />
      {[bull, bear].map((layout, si) => layout.placed.map(p => (
        <Element key={`${si}:${p.asset?.symbol ?? "more"}`} p={p} maxMove={maxMove} focus={focus} onHover={onHover} onPick={onPick} side={si === 0 ? 'bullish' : 'bearish'} />
      )))}
    </div>
  );
}

/* ---------------------------------------------------------------- status */

function Status({ flow, timeZone }: { flow: Flow; timeZone?: string }) {
  const up = flow.bullish.length;
  const down = flow.bearish.length;
  const flat = flow.rangebound.length;
  const lead = flow.sectors[0];
  const lag = flow.sectors[flow.sectors.length - 1];
  return (
    <div className="status" style={{ left: 0, top: 0, width: W }}>
      <span className={`src${flow.live ? ' live' : ''}`}><i />{flow.source}{flow.note ? <em> · {flow.note}</em> : null}</span>
      <span className="split">
        <b className="bull">{up} up</b> · <b>{flat} flat</b> · <b className="bear">{down} down</b> <span className="muted">of {flow.assets.length}</span>
      </span>
      <span className="muted">As of {clock(flow.asOf, timeZone)} · {flow.window.label} window {flow.window.scope}</span>
      <span className="leaders">
        {lead && <span><b className="bull">▲ Leading</b> {lead.label} {signedPct(lead.changePct)}</span>}
        {lag && lag !== lead && <span><b className="bear">▼ Lagging</b> {lag.label} {signedPct(lag.changePct)}</span>}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- spread strip */

function Spread({ flow, max, focus, onHover, onPick }: { flow: Flow; max: number; focus: Set<string> | null; onHover: (s: string | null) => void; onPick: (s: string) => void }) {
  const pal = usePalette();
  const x0 = G.chartX0;
  const x1 = G.chartX1;
  const cy = 58;
  const tick = { fill: pal.muted, fontSize: 10.5, fontFamily: MONO };
  const x = (pct: number) => x0 + ((Math.max(-max, Math.min(max, pct)) + max) / (2 * max)) * (x1 - x0);
  // a simple beeswarm: stack dots that would overlap
  const sorted = [...flow.assets].sort((a, b) => a.changePct - b.changePct);
  const rows: number[] = [];
  const placed = sorted.map(a => {
    const px = x(a.changePct);
    let row = 0;
    while (rows[row] != null && px - rows[row] < 6.5) row++;
    rows[row] = px;
    const offset = row === 0 ? 0 : (row % 2 ? -1 : 1) * Math.ceil(row / 2) * 6;
    return { a, px, py: cy + Math.max(-14, Math.min(14, offset)) };
  });
  return (
    <svg className="spread" width={W} height={90} style={{ left: 0, top: 0 }} viewBox={`0 0 ${W} 90`}>
      <text className="cap" x={G.sectorsX} y={cy + 4} fill={pal.muted} fontSize={11} fontWeight={600} fontFamily={FONT} letterSpacing="0.06em">{`SPREAD OF THE ${flow.window.label.toUpperCase()}`}</text>
      <line className="axis" x1={x0} x2={x1} y1={cy} y2={cy} stroke={pal.line} />
      <line className="zero" x1={x(0)} x2={x(0)} y1={cy - 16} y2={cy + 16} stroke={pal.ink} strokeOpacity={0.35} />
      <text className="tick" x={x0} y={cy + 28} {...tick}>{signedPct(-max, 1)}</text>
      <text className="tick" x={x(0)} y={cy + 28} textAnchor="middle" {...tick}>0%</text>
      <text className="tick" x={x1} y={cy + 28} textAnchor="end" {...tick}>{signedPct(max, 1)}</text>
      {placed.map(({ a, px, py }) => a.isBenchmark ? (
        <rect key={a.symbol} className={`dot bench${focus && !focus.has(a.symbol) ? ' dim' : ''}`} x={px - 4.2} y={py - 4.2} width={8.4} height={8.4} transform={`rotate(45 ${px} ${py})`} fill={pal.bench}
          onMouseEnter={() => onHover(a.symbol)} onMouseLeave={() => onHover(null)} onClick={() => onPick(a.symbol)}><title>{a.symbol} {signedPct(a.changePct)}</title></rect>
      ) : (
        <circle key={a.symbol} className={`dot ${sideClass(a)}${focus && !focus.has(a.symbol) ? ' dim' : ''}${focus?.has(a.symbol) ? ' hot' : ''}`} cx={px} cy={py} r={3.3} fill={sideColor(pal, a.side)}
          onMouseEnter={() => onHover(a.symbol)} onMouseLeave={() => onHover(null)} onClick={() => onPick(a.symbol)}><title>{a.symbol} {signedPct(a.changePct)}</title></circle>
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- sectors */

function Sectors({ flow, hotSector, onHoverSector }: { flow: Flow; hotSector: string | null; onHoverSector: (s: string | null) => void }) {
  const n = flow.sectors.length;
  const gap = 6;
  const h = Math.min(54, (G.bottom - G.top - gap * (n - 1)) / Math.max(1, n));
  const total = n * h + (n - 1) * gap;
  const top = MID - total / 2;
  return (
    <>
      {flow.sectors.map((s, i) => {
        const count = s.bullish + s.bearish + s.rangebound;
        return (
          <div key={s.id} className={`sector ${s.lean === 'bullish' ? 'bull' : s.lean === 'bearish' ? 'bear' : 'flat'}${hotSector === s.id ? ' hot' : ''}`}
            style={{ left: G.sectorsX, top: top + i * (h + gap), width: G.sectorsW, height: h }}
            onMouseEnter={() => onHoverSector(s.id)} onMouseLeave={() => onHoverSector(null)} title={`${s.label}: ${s.bullish} up, ${s.rangebound} flat, ${s.bearish} down`}>
            <div className="row"><span className="name">{s.label}</span><span className="pct">{signedPct(s.changePct)}</span></div>
            <div className="splitbar">
              <i className="b" style={{ flexGrow: s.bullish / count }} />
              <i className="f" style={{ flexGrow: s.rangebound / count }} />
              <i className="r" style={{ flexGrow: s.bearish / count }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------------------- the lines, tunnels and fan */

interface Scale { max: number; y: (pct: number) => number; ticks: number[] }

const Lines = memo(function Lines({ flow, scale, bull, bear, focus, timeZone }: { flow: Flow; scale: Scale; bull: SideLayout; bear: SideLayout; focus: Set<string> | null; timeZone?: string }) {
  const pal = usePalette();
  const named = new Set([...flow.bullish.slice(0, NAMED_PER_SIDE), ...flow.bearish.slice(0, NAMED_PER_SIDE)].map(a => a.symbol));
  const lineAttrs = (a: FlowAsset) => a.isBenchmark
    ? { fill: 'none', stroke: pal.bench, strokeWidth: 1.7, strokeDasharray: '1.5 3.5', opacity: 0.85 }
    : { fill: 'none', stroke: sideColor(pal, a.side), strokeWidth: named.has(a.symbol) ? 2 : 1, opacity: named.has(a.symbol) ? 0.95 : a.side === 'rangebound' ? 0.32 : 0.28 };
  const gtext = { fill: pal.muted, fontSize: 10.5, fontFamily: MONO };

  // Tunnel slots: each side's lines pass through in the order of their ports.
  const slots = new Map<string, number>();
  for (const [layout, list] of [[bull, flow.bullish], [bear, flow.bearish]] as const) {
    const ordered = [...list].sort((a, b) => layout.bySymbol.get(a.symbol)!.portY - layout.bySymbol.get(b.symbol)!.portY);
    const { y0, y1 } = layout.tunnel;
    ordered.forEach((a, i) => slots.set(a.symbol, ordered.length === 1 ? (y0 + y1) / 2 : y0 + 3 + ((y1 - y0 - 6) * i) / (ordered.length - 1)));
  }
  const flatOrder = [...flow.rangebound].sort((a, b) => b.changePct - a.changePct);
  flatOrder.forEach((a, i) => slots.set(a.symbol, MID - 5 + (10 * (i + 0.5)) / Math.max(1, flatOrder.length)));

  const paths = flow.assets.map(a => {
    const pts = thin(a.points);
    let d = '';
    pts.forEach((p, i) => { d += `${i ? 'L' : 'M'}${Math.min(G.chartX1, timeX(flow, p.t)).toFixed(1)},${scale.y(p.pct).toFixed(1)}`; });
    const last = pts[pts.length - 1];
    const ex = Math.min(G.chartX1, timeX(flow, last.t));
    const ey = scale.y(last.pct);
    const sy = slots.get(a.symbol) ?? MID;
    const bend = G.tunnelX0 - ex;
    d += `C${(ex + bend * 0.55).toFixed(1)},${ey.toFixed(1)} ${(G.tunnelX0 - bend * 0.25).toFixed(1)},${sy.toFixed(1)} ${G.tunnelX0},${sy.toFixed(1)}`;
    if (a.side === 'rangebound') {
      d += `L${G.tunnelX1 + 30},${sy.toFixed(1)}`;
    } else {
      const port = (a.side === 'bullish' ? bull : bear).bySymbol.get(a.symbol)?.portY ?? sy;
      d += `L${G.tunnelX1},${sy.toFixed(1)}C${G.tunnelX1 + 38},${sy.toFixed(1)} ${G.portX - 38},${port.toFixed(1)} ${G.portX},${port.toFixed(1)}`;
    }
    return { a, d, ex, ey };
  });

  // Labels for the biggest movers, pushed apart so they never collide.
  const labels = paths.filter(p => named.has(p.a.symbol) || p.a.isBenchmark).map(p => ({ ...p, ly: p.ey })).sort((u, v) => u.ly - v.ly);
  for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < 13) labels[i].ly = labels[i - 1].ly + 13;
  for (let i = labels.length - 2; i >= 0; i--) if (labels[i + 1].ly > G.bottom && labels[i + 1].ly - labels[i].ly < 13) labels[i].ly = labels[i + 1].ly - 13;

  const xTicks = timeTicks(flow);
  const cls = (a: FlowAsset) => {
    const base = a.isBenchmark ? 'ln bench' : `ln ${sideClass(a)}${named.has(a.symbol) ? ' named' : ''}`;
    if (!focus) return base;
    return `${base}${focus.has(a.symbol) ? ' hot' : ' dim'}`;
  };
  // Draw quiet lines first, named lines and the benchmark on top, the focused line last.
  const order = [...paths].sort((u, v) => weight(u.a) - weight(v.a) || (focus?.has(u.a.symbol) ? 1 : 0) - (focus?.has(v.a.symbol) ? 1 : 0));
  function weight(a: FlowAsset) { return (focus?.has(a.symbol) ? 10 : 0) + (a.isBenchmark ? 3 : named.has(a.symbol) ? 2 : 0); }

  return (
    <svg className="lines" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ left: 0, top: 0 }}>
      <defs>
        <linearGradient id="tun-bull" x1="0" x2="1"><stop offset="0" stopColor={pal.bull} stopOpacity={0.08} /><stop offset="0.5" stopColor={pal.bull} stopOpacity={0.2} /><stop offset="1" stopColor={pal.bull} stopOpacity={0.08} /></linearGradient>
        <linearGradient id="tun-bear" x1="0" x2="1"><stop offset="0" stopColor={pal.bear} stopOpacity={0.08} /><stop offset="0.5" stopColor={pal.bear} stopOpacity={0.2} /><stop offset="1" stopColor={pal.bear} stopOpacity={0.08} /></linearGradient>
        <linearGradient id="half-bull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pal.bull} stopOpacity={0.07} /><stop offset="1" stopColor={pal.bull} stopOpacity={0} /></linearGradient>
        <linearGradient id="half-bear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pal.bear} stopOpacity={0} /><stop offset="1" stopColor={pal.bear} stopOpacity={0.07} /></linearGradient>
      </defs>
      {/* half washes behind the chart */}
      <rect className="wash" x={G.chartX0} y={G.top} width={G.chartX1 - G.chartX0} height={MID - G.top} fill="url(#half-bull)" />
      <rect className="wash" x={G.chartX0} y={MID} width={G.chartX1 - G.chartX0} height={G.bottom - MID} fill="url(#half-bear)" />
      {/* grid */}
      {scale.ticks.map(v => (
        <g key={v} className={`grid${v === 0 ? ' zero' : ''}`}>
          <line x1={G.chartX0} x2={G.chartX1} y1={scale.y(v)} y2={scale.y(v)} stroke={v === 0 ? pal.ink : pal.grid} strokeOpacity={v === 0 ? 0.4 : 1} strokeWidth={v === 0 ? 1.2 : 1} />
          <text x={G.chartX0 - 8} y={scale.y(v) + 4} textAnchor="end" {...gtext} fill={v === 0 ? pal.ink : pal.muted} fontWeight={v === 0 ? 600 : 400}>{v === 0 ? '0%' : signedPct(v, Math.abs(v) < 1 ? 1 : 0).replace('.0%', '%')}</text>
        </g>
      ))}
      {xTicks.map(t => (
        <g key={t} className="grid vt">
          <line x1={timeX(flow, t)} x2={timeX(flow, t)} y1={G.top} y2={G.bottom} stroke={pal.grid} strokeDasharray="2 4" />
          <text x={timeX(flow, t)} y={G.bottom + 18} textAnchor="middle" {...gtext}>{clock(t, timeZone)}</text>
        </g>
      ))}
      {flow.end > flow.asOf + 60_000 && (
        <g className="now">
          <line x1={timeX(flow, flow.asOf)} x2={timeX(flow, flow.asOf)} y1={G.top} y2={G.bottom} stroke={pal.ink} strokeOpacity={0.35} strokeDasharray="3 3" />
          <text x={timeX(flow, flow.asOf)} y={G.top - 6} textAnchor="middle" {...gtext} fontSize={10}>now</text>
        </g>
      )}
      {/* the zero line carried through to the bar */}
      <line className="zero-run" x1={G.chartX1} x2={G.tunnelX0} y1={MID} y2={MID} stroke={pal.ink} strokeOpacity={0.25} strokeWidth={1.2} />
      {/* tunnels */}
      {[{ l: bull, id: 'bull' }, { l: bear, id: 'bear' }].map(({ l, id }) => (
        <g key={id} className={`tunnel ${id}`}>
          <rect x={G.tunnelX0 - 4} y={l.tunnel.y0 - 7} width={G.tunnelX1 - G.tunnelX0 + 8} height={l.tunnel.y1 - l.tunnel.y0 + 14} rx={10} fill={`url(#tun-${id})`} />
          <rect className="rim" x={G.tunnelX0 - 4} y={l.tunnel.y0 - 7} width={G.tunnelX1 - G.tunnelX0 + 8} height={l.tunnel.y1 - l.tunnel.y0 + 14} rx={10} fill="none" stroke={id === 'bull' ? pal.bull : pal.bear} strokeOpacity={0.4} />
        </g>
      ))}
      {order.map(({ a, d }) => <path key={a.symbol} className={cls(a)} d={d} {...lineAttrs(a)} />)}
      {/* lines carried on to the tall tiles and cards, under the tiles */}
      {[...flow.bullish, ...flow.bearish].map(a => {
        const p = (a.side === 'bullish' ? bull : bear).bySymbol.get(a.symbol);
        if (!p || (p.slot !== 'tall' && p.slot !== 'card')) return null;
        return <path key={a.symbol} className={`ext ${sideClass(a)}${focus ? (focus.has(a.symbol) ? ' hot' : ' dim') : ''}`} d={`M${G.portX},${p.portY.toFixed(1)}L${p.x},${p.portY.toFixed(1)}`} fill="none" stroke={sideColor(pal, a.side)} strokeDasharray="2 3" opacity={0.35} />;
      })}
      {/* ports */}
      {[...flow.bullish, ...flow.bearish].map(a => {
        const p = (a.side === 'bullish' ? bull : bear).bySymbol.get(a.symbol);
        return p ? <circle key={a.symbol} className={`port ${sideClass(a)}${focus?.has(a.symbol) ? ' hot' : ''}`} cx={G.portX} cy={p.portY} r={1.8} fill={sideColor(pal, a.side)} /> : null;
      })}
      {/* end labels */}
      {labels.map(({ a, ex, ey, ly }) => (
        <g key={a.symbol} className={`lbl ${a.isBenchmark ? 'bench' : sideClass(a)}${focus && !focus.has(a.symbol) ? ' dim' : ''}`}>
          {Math.abs(ly - ey) > 3 && <line x1={ex - 4} y1={ey} x2={ex - 10} y2={ly + 0.5} stroke={a.isBenchmark ? pal.ink : sideColor(pal, a.side)} />}
          <text x={ex - 12} y={ly + 4} textAnchor="end" fill={a.isBenchmark ? pal.ink : sideInk(pal, a.side)} fontSize={11} fontWeight={700} fontFamily={FONT} stroke={pal.bg} strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke">{a.isBenchmark ? '◆ ' : ''}{a.symbol} <tspan fontFamily={MONO} fontWeight={500}>{signedPct(a.changePct)}</tspan></text>
        </g>
      ))}
      {/* tunnel captions */}
      <text className="tcap bull" x={(G.tunnelX0 + G.tunnelX1) / 2} y={bull.tunnel.y0 - 14} textAnchor="middle" fill={pal.bullInk} fontSize={10.5} fontWeight={700} fontFamily={FONT} letterSpacing="0.08em">▲ BULLISH {flow.bullish.length}</text>
      <text className="tcap bear" x={(G.tunnelX0 + G.tunnelX1) / 2} y={bear.tunnel.y1 + 24} textAnchor="middle" fill={pal.bearInk} fontSize={10.5} fontWeight={700} fontFamily={FONT} letterSpacing="0.08em">▼ BEARISH {flow.bearish.length}</text>
    </svg>
  );
});

function timeTicks(flow: Flow): number[] {
  const span = flow.end - flow.start;
  const steps = [5, 10, 15, 30, 60, 120, 180, 240, 360].map(m => m * 60_000);
  const step = steps.find(s => span / s <= 7) ?? 6 * 3600_000;
  const out: number[] = [];
  for (let t = Math.ceil(flow.start / step) * step; t <= flow.end; t += step) if (t > flow.start + step * 0.3) out.push(t);
  return out;
}

/* ---------------------------------------------------------------- the bar (rangebound) */

function Bar({ flow, focus, onHover, onPick }: { flow: Flow; focus: Set<string> | null; onHover: (s: string | null) => void; onPick: (s: string) => void }) {
  const names = flow.rangebound;
  return (
    <div className="bar" style={{ left: G.tunnelX1 + 30, top: MID - G.barH / 2, width: W - G.tunnelX1 - 30, height: G.barH }}>
      <span className="cap">Rangebound {names.length}</span>
      {names.slice(0, 26).map(a => (
        <button key={a.symbol} className={`chip${focus?.has(a.symbol) ? ' hot' : ''}`} onMouseEnter={() => onHover(a.symbol)} onMouseLeave={() => onHover(null)} onClick={() => onPick(a.symbol)}>
          {a.symbol} <span>{signedPct(a.changePct, 1)}</span>
        </button>
      ))}
      {names.length > 26 && <span className="cap">+{names.length - 26}</span>}
      {!names.length && <span className="cap muted">every name moved past ±{flow.window.floor}%</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- tiles, tall tiles, cards */

function Element({ p, maxMove, focus, onHover, onPick, side }: { p: Placed; maxMove: number; focus: Set<string> | null; onHover: (s: string | null) => void; onPick: (s: string) => void; side: 'bullish' | 'bearish' }) {
  const style = { left: p.x, top: p.y, width: p.w, height: p.h };
  if (p.slot === 'more' || !p.asset) {
    return <div className={`tile more ${side === 'bullish' ? 'bull' : 'bear'}`} style={style}><b>+{p.more}</b><span>more {side}</span></div>;
  }
  const a = p.asset;
  const sc = sideClass(a);
  const hot = focus?.has(a.symbol);
  const dim = focus && !hot;
  const handlers = {
    role: 'button', tabIndex: 0,
    onMouseEnter: () => onHover(a.symbol), onMouseLeave: () => onHover(null), onClick: () => onPick(a.symbol),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(a.symbol); } },
    onFocus: () => onHover(a.symbol), onBlur: () => onHover(null),
  };
  const intensity = Math.min(1, Math.abs(a.changePct) / maxMove);
  const cls = `${sc}${hot ? ' hot' : ''}${dim ? ' dim' : ''}`;

  if (p.slot === 'tile') {
    return (
      <div className={`tile ${cls}${a.isBenchmark ? ' benchmark' : ''}`} title={a.isBenchmark ? `${a.symbol}, the benchmark` : undefined} style={{ ...style, ['--k' as string]: (0.1 + intensity * 0.9).toFixed(3) }} {...handlers}>
        <span className="top"><b>{a.symbol}</b><span className="pct">{signedPct(a.changePct)}</span></span>
        <span className="bu"><i className={a.buildUp.fresh ? 'fill' : 'ring'} />{SHORT_BUILDUP[a.buildUp.code]}</span>
      </div>
    );
  }

  if (p.slot === 'tall') {
    return (
      <div className={`tall ${cls}`} style={style} {...handlers}>
        <span className="top"><b>{a.symbol}</b><span className="pct">{signedPct(a.changePct)}</span></span>
        <span className="bu"><i className={a.buildUp.fresh ? 'fill' : 'ring'} />{SHORT_BUILDUP[a.buildUp.code]}</span>
        <Profile a={a} height={p.h - 64} width={p.w - 16} />
      </div>
    );
  }

  const held = a.checksHeld;
  return (
    <div className={`card ${cls}`} style={style} {...handlers}>
      <span className="head">
        <span className="id"><b>{a.symbol}</b><span className="nm">{a.name}</span></span>
        <span className="right">
          <span className="conv" title={`${held} of ${a.checksCounted} checks of conviction hold`}>{a.checks.map(c => <i key={c.id} className={c.pass == null ? 'na' : c.pass ? 'ok' : 'no'} />)}</span>
          <span className={`badge ${sc}`}>{a.side === 'bullish' ? 'Bullish' : 'Bearish'}</span>
        </span>
      </span>
      <span className="mid">
        <span className="big">
          <span className="pct">{signedPct(a.changePct)}</span>
          <span className="px">{price(a.price)} <em>{signedPrice(a.price - a.base)}</em></span>
          <span className="bu"><i className={a.buildUp.fresh ? 'fill' : 'ring'} />{a.buildUp.label}</span>
        </span>
        <Candles candles={a.candles} width={122} height={50} max={30} support={a.support} resistance={a.resistance} zone={a.zone} className="mini" />
      </span>
      <span className="foot">
        <span><em>Support</em>{a.support ? shortPrice(a.support.price) : '—'}</span>
        <span><em>Zone</em>{a.zone ? `${shortPrice(a.zone.low)}–${shortPrice(a.zone.high)}` : '—'}</span>
        <span><em>Resistance</em>{a.resistance ? shortPrice(a.resistance.price) : '—'}</span>
      </span>
    </div>
  );
}

/** Open interest (or traded volume) by price around spot: puts / volume below on the left, calls / volume above on the right. */
function Profile({ a, width, height }: { a: FlowAsset; width: number; height: number }) {
  const pal = usePalette();
  const rows = [...a.profile].sort((x, y) => y.price - x.price);
  if (!rows.length) return <span className="noprof">no profile</span>;
  const max = Math.max(1, ...rows.map(r => Math.max(r.left, r.right)));
  const rh = Math.min(12, (height - 6) / rows.length);
  const mid = width / 2;
  const isOptions = a.support?.kind === 'options' || a.resistance?.kind === 'options';
  let spotY = 0;
  rows.forEach((r, i) => { if (r.price >= a.price) spotY = (i + 1) * rh; });
  return (
    <svg className="profile" width={width} height={rows.length * rh + 4} viewBox={`0 0 ${width} ${rows.length * rh + 4}`}>
      {rows.map((r, i) => (
        <g key={r.price}>
          {r.left > 0 && <rect className="pl" fill={pal.bullLine} opacity={0.75} x={mid - (r.left / max) * (mid - 2)} y={i * rh + 1} width={(r.left / max) * (mid - 2)} height={rh - 2} rx={1} />}
          {r.right > 0 && <rect className="pr" fill={pal.bearLine} opacity={0.75} x={mid} y={i * rh + 1} width={(r.right / max) * (mid - 2)} height={rh - 2} rx={1} />}
        </g>
      ))}
      <line className="spot" x1={0} x2={width} y1={spotY} y2={spotY} stroke={pal.ink} strokeOpacity={0.5} strokeDasharray="2 2" />
      <g className="spotTag"><rect x={mid - 26} y={spotY - 7} width={52} height={14} rx={7} fill={pal.ink} /><text x={mid} y={spotY + 3.5} textAnchor="middle" fill={pal.bg} fontSize={9} fontFamily={MONO} fontWeight={600}>{price(a.price)}</text></g>
      {isOptions && <text className="ptag" x={1} y={rows.length * rh + 3} fill={pal.muted} fontSize={8.5} fontFamily={FONT}>PUTS</text>}
      {isOptions && <text className="ptag" x={width - 1} y={rows.length * rh + 3} textAnchor="end" fill={pal.muted} fontSize={8.5} fontFamily={FONT}>CALLS</text>}
    </svg>
  );
}

