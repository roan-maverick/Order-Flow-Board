export const MIN = 60_000;
export const BAR = 5 * MIN;

/** Minutes east of UTC for a time zone at a moment (e.g. New York: -240 or -300). */
export function zoneOffsetMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / MIN);
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

export const floorTo = (t: number, step: number) => Math.floor(t / step) * step;
