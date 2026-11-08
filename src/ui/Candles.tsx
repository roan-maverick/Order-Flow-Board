import type { Candle } from '../data/types';
import type { Level, Zone } from '../model/flow';
import { clock, price } from './format';
import { MONO } from './palette';
import { usePalette } from './usePalette';

/** Groups bars into at most `max` candles. */
export function aggregate(candles: Candle[], max: number): Candle[] {
  if (candles.length <= max) return candles;
  const size = Math.ceil(candles.length / max);
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += size) {
    const g = candles.slice(i, i + size);
    out.push({
      t: g[0].t, o: g[0].o, c: g[g.length - 1].c,
      h: Math.max(...g.map(c => c.h)), l: Math.min(...g.map(c => c.l)),
      v: g.reduce((s, c) => s + c.v, 0),
    });
  }
  return out;
}

interface Props {
  candles: Candle[];
  width: number;
  height: number;
  max?: number;
  support?: Level | null;
  resistance?: Level | null;
  zone?: Zone | null;
  /** Draw price labels on the levels and a time axis. */
  detailed?: boolean;
  timeZone?: string;
  className?: string;
}

export function Candles({ candles, width, height, max = 40, support, resistance, zone, detailed = false, timeZone, className }: Props) {
  const pal = usePalette();
  const bars = aggregate(candles, max);
  if (!bars.length) return <svg width={width} height={height} className={className} />;
  const padR = detailed ? 64 : 2;
  const padB = detailed ? 18 : 2;
  const padT = detailed ? 8 : 2;
  let lo = Math.min(...bars.map(b => b.l));
  let hi = Math.max(...bars.map(b => b.h));
  // In detail, widen the range to show the levels when they are reasonably near.
  if (detailed) {
    for (const lv of [support, resistance]) {
      if (lv && Math.abs(lv.distancePct) < 12) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
    }
  }
  const pad = (hi - lo) * 0.06 || hi * 0.001;
  lo -= pad;
  hi += pad;
  const plotW = width - padR;
  const plotH = height - padB - padT;
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * plotH;
  const step = plotW / bars.length;
  const bw = Math.max(1, Math.min(9, step * 0.62));
  const t0 = bars[0].t;
  const t1 = bars[bars.length - 1].t;
  const tx = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (plotW - step) + step / 2;
  const level = (lv: Level | null | undefined, cls: string, label: string) => {
    if (!lv || lv.price < lo || lv.price > hi) return null;
    return (
      <g className={`lvl ${cls}`}>
        <line x1={0} x2={plotW} y1={y(lv.price)} y2={y(lv.price)} stroke={cls === 'sup' ? pal.bull : pal.bear} strokeDasharray="3 3" />
        {detailed && <text x={plotW + 4} y={y(lv.price) + 3.5} fill={cls === 'sup' ? pal.bullInk : pal.bearInk} fontSize={10.5} fontFamily={MONO} fontWeight={600}>{label} {price(lv.price)}</text>}
      </g>
    );
  };
  const ticks = detailed ? [0, 0.25, 0.5, 0.75, 1].map(f => bars[Math.min(bars.length - 1, Math.round(f * (bars.length - 1)))]) : [];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={`candles ${className ?? ''}`}>
      {zone && zone.high >= lo && zone.low <= hi && (
        <rect className="zone" fill={pal.ink} fillOpacity={0.07} x={Math.max(0, tx(zone.from) - step / 2)} width={Math.max(step, tx(zone.to) - tx(zone.from))} y={y(Math.min(hi, zone.high))} height={Math.max(2, y(Math.max(lo, zone.low)) - y(Math.min(hi, zone.high)))} />
      )}
      {level(support, 'sup', 'S')}
      {level(resistance, 'res', 'R')}
      {bars.map(b => {
        const x = tx(b.t);
        const up = b.c >= b.o;
        const col = up ? pal.bullLine : pal.bearLine;
        return (
          <g key={b.t} className={up ? 'up' : 'dn'} fill={col} stroke={col}>
            <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} />
            <rect x={x - bw / 2} width={bw} y={y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} />
          </g>
        );
      })}
      {detailed && (
        <g className="axis" fill={pal.muted} fontSize={10.5} fontFamily={MONO}>
          <text x={plotW + 4} y={padT + 8}>{price(hi)}</text>
          <text x={plotW + 4} y={padT + plotH}>{price(lo)}</text>
          {ticks.map((b, i) => <text key={i} x={tx(b.t)} y={height - 4} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{clock(b.t, timeZone)}</text>)}
        </g>
      )}
    </svg>
  );
}
