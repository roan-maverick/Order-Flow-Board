import type { MarketData } from './types';

/**
 * US stocks come from a file the site's build step writes (scripts/build-us-data.mjs,
 * run by GitHub Actions every 15 minutes in market hours): 5-minute bars,
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
