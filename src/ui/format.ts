export const signedPct = (v: number | null | undefined, digits = 2) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${abs.toFixed(abs >= 100 ? 0 : digits)}%`;
};

/** Prices from $0.000012 to $104,000 with sensible precision. */
export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 10000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signedPrice(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${price(Math.abs(v))}`;
}

export function compactUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function clock(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(t));
}

export function dayLabel(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(new Date(t));
}

export function zoneName(timeZone?: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', timeZone }).formatToParts(new Date()).find(p => p.type === 'timeZoneName');
  return part?.value ?? '';
}

/** Short build-up words for a tile. */
export const SHORT_BUILDUP: Record<string, string> = {
  LONG_BUILD: 'Long build-up',
  SHORT_COVER: 'Short covering',
  SHORT_BUILD: 'Short build-up',
  LONG_UNWIND: 'Long unwinding',
  ACCUMULATION: 'Heavy buying',
  DRIFT_UP: 'Quiet rise',
  DISTRIBUTION: 'Heavy selling',
  DRIFT_DOWN: 'Quiet dip',
  NEUTRAL: 'No new positions',
};

/** About four significant digits, for tight spaces (levels and zones on cards). */
export function shortPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 10000) return Math.round(v).toLocaleString('en-US');
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}
