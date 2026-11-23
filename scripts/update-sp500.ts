/**
 * Refreshes the bundled S&P 500 list (src/data/sp500.json) from the open dataset.
 *
 *   npm run update:sp500
 *
 * The server already reads the latest list on start; the bundled copy is the
 * fallback for when you are offline.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseConstituents, SP500_CSV_URL } from '../server/us/sp500';

const res = await fetch(SP500_CSV_URL);
if (!res.ok) throw new Error(`${res.status} from ${SP500_CSV_URL}`);
const list = parseConstituents(await res.text());
if (list.length < 480) throw new Error(`only ${list.length} members parsed; not replacing the bundled list`);
const out = resolve(import.meta.dirname, '../src/data/sp500.json');
const body = {
  source: SP500_CSV_URL,
  updated: new Date().toISOString().slice(0, 10),
  members: list.map(c => [c.symbol, c.name, c.sector]),
};
await writeFile(out, JSON.stringify(body, null, 0).replace(/\],\[/g, '],\n[') + '\n');
console.log(`wrote ${list.length} members to src/data/sp500.json`);
