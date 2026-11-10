import type { MarketData } from './types';

/**
 * US stocks come from a local file written by scripts/build-us-data.mjs
 * (`npm run data:us`): 5-minute bars,
 * relative volume and option open interest by strike for each name.
 */
export async function loadUs(): Promise<MarketData> {
  const url = `${import.meta.env.BASE_URL}data/us.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no US file (${res.status})`);
  const data = (await res.json()) as MarketData;
  if (data.market !== 'us' || !Array.isArray(data.assets) || data.assets.length < 5) throw new Error('the US file is empty');
  return data;
}
