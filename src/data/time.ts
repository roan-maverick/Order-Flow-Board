export const MIN = 60_000;
export const BAR = 5 * MIN;

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
const HOUR = 60 * MIN;

/**
 * Minutes east of UTC for a time zone at a moment (e.g. New York: -240 or -300).
 * Offsets only change on the hour (daylight saving), so each hour is worked out
 * once and remembered: this runs for every bar of every stock.
 */
export function zoneOffsetMinutes(at: number, timeZone: string): number {
  const hour = Math.floor(at / HOUR);
  const key = `${timeZone}|${hour}`;
  const known = offsets.get(key);
  if (known != null) return known;
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const probe = hour * HOUR;
  const parts = fmt.formatToParts(new Date(probe));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = Math.round((asUtc - probe) / MIN);
  if (offsets.size > 50_000) offsets.clear();
  offsets.set(key, offset);
  return offset;
}

/** Epoch ms of a wall-clock time on a New York date (YYYY-MM-DD). */
export function nyTime(date: string, hour: number, minute: number): number {
  const guess = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const offset = zoneOffsetMinutes(guess, 'America/New_York');
  return guess - offset * MIN;
}

/** New York calendar date (YYYY-MM-DD) and weekday (0 Sun) at a moment. */
export function nyDate(at: number): { date: string; weekday: number } {
  const offset = zoneOffsetMinutes(at, 'America/New_York');
  const d = new Date(at + offset * MIN);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() };
}

/** The most recent US regular session (09:30–16:00 ET) that has opened by `at`. Holidays are not known here. */
export function lastUsSession(at: number): { date: string; open: number; close: number } {
  for (let back = 0; back < 10; back++) {
    const { date, weekday } = nyDate(at - back * 1440 * MIN);
    if (weekday === 0 || weekday === 6) continue;
    const open = nyTime(date, 9, 30);
    if (open > at) continue;
    return { date, open, close: nyTime(date, 16, 0) };
  }
  throw new Error('no session found');
}

/** The regular session (09:30–16:00 New York) of a New York date. */
/**
 * The next weekday at 09:36 New York time after `at`: a few minutes past the
 * open, once the first 5-minute bar of the day exists. Holidays are not known
 * here; on a holiday the check simply finds no new session and tries again.
 */
export function nextUsOpenCheck(at: number): number {
  const today = nyDate(at).date;
  for (let d = 0; d <= 7; d++) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const t = nyTime(date, 9, 36);
    if (t > at) return t;
  }
  return at + 24 * 60 * MIN;
}

export const usSessionOf = (date: string) => ({ open: nyTime(date, 9, 30), close: nyTime(date, 16, 0) });

export const floorTo = (t: number, step: number) => Math.floor(t / step) * step;
