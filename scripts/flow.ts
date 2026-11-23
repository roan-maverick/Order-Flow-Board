export {};
/**
 * Read the board from the terminal.
 *
 *   npm run flow                                  US board brief (S&P 500, day window)
 *   npm run flow -- crypto                        crypto board brief
 *   npm run flow -- us --window 1h --universe top100
 *   npm run flow -- us --symbol NVDA              one name in full
 *   npm run flow -- us --side bullish --min-checks 4 --fresh     filtered setups
 *   npm run flow -- us --json                     raw JSON (pipe it into jq or a script)
 *
 * The board must be running (npm start) in another terminal.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true') : undefined;
};
const market = args.find(a => a === 'us' || a === 'crypto') ?? 'us';
const base = (process.env.FLOW_URL ?? `http://127.0.0.1:${process.env.PORT ?? 5199}`).replace(/\/$/, '');

const q = new URLSearchParams();
for (const [param, name] of [['window', 'window'], ['universe', 'universe'], ['side', 'side'], ['minChecks', 'min-checks'], ['sector', 'sector'], ['limit', 'limit'], ['buildUp', 'build-up']] as const) {
  const v = flag(name);
  if (v) q.set(param, v);
}
if (flag('fresh')) q.set('fresh', 'true');
const symbol = flag('symbol');
const filtered = ['side', 'minChecks', 'sector', 'buildUp', 'fresh'].some(k => q.has(k));
const json = !!flag('json');
if (!json && !filtered) q.set('format', 'text');
if (symbol && !json) q.set('format', 'text');

const url = `${base}/api/flow/${market}${symbol ? `/${encodeURIComponent(symbol.toUpperCase())}` : ''}?${q}`;
let res: Response;
try {
  res = await fetch(url);
} catch {
  console.error(`\nThe board is not running at ${base}. Start it in another terminal with:  npm start\n`);
  process.exit(1);
}
const body = await res.text();
if (!res.ok) {
  console.error(body);
  process.exit(1);
}
if (json || !filtered || symbol) {
  console.log(body);
} else {
  const b = JSON.parse(body) as { results: Array<{ symbol: string; sector: string; changePct: number; buildUp: { label: string }; conviction: { held: number; counted: number }; support: { price: number } | null; resistance: { price: number } | null }> };
  if (!b.results.length) console.log('No names match those filters right now.');
  for (const a of b.results) {
    console.log(`${a.symbol.padEnd(7)}${`${a.changePct > 0 ? '+' : ''}${a.changePct.toFixed(2)}%`.padStart(9)}  ${a.buildUp.label.padEnd(26)} ${a.conviction.held}/${a.conviction.counted} checks   S ${a.support?.price ?? '-'}  R ${a.resistance?.price ?? '-'}   ${a.sector}`);
  }
}
