#!/usr/bin/env node
/**
 * Global Order Flow for AI assistants (MCP).
 *
 * Lets Claude (Desktop or Code), Cursor, or any app that speaks the Model
 * Context Protocol read the live board: the market's breadth and sectors,
 * the strongest setups, and any single name in full.
 *
 * It reads from the board running on your computer, so start that first
 * (npm start). Setup steps are in the README under "Connect it to Claude".
 *
 *   FLOW_URL   where the board runs (default http://127.0.0.1:5199)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.FLOW_URL ?? 'http://127.0.0.1:5199').replace(/\/$/, '');
const NOT_RUNNING = `The Global Order Flow board is not running at ${BASE}. Open a terminal in the project folder and run "npm start", then ask again.`;

async function call(path, format = 'json') {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return { error: NOT_RUNNING };
  }
  const raw = await res.text();
  let body = raw;
  if (format !== 'text' || !res.ok) {
    try { body = JSON.parse(raw); } catch { /* plain text */ }
  }
  if (!res.ok) {
    const message = typeof body === 'object' && body?.error ? body.error : typeof body === 'string' ? body : `HTTP ${res.status}`;
    return { error: res.status === 503 ? `The board is still loading: ${message}. Try again in a minute.` : message };
  }
  return { body };
}

const text = t => ({ content: [{ type: 'text', text: t }] });
const fail = t => ({ content: [{ type: 'text', text: t }], isError: true });

const query = params => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

const market = z.enum(['us', 'crypto']).describe('"us" for US stocks (S&P 500), "crypto" for crypto perpetual futures');
const windowArg = z.enum(['day', '1h', '15m', '24h', '4h']).optional()
  .describe('Time window. US: day (since the previous close), 1h, 15m. Crypto: 24h, 4h, 1h. Default: day for US, 24h for crypto.');
const universe = z.enum(['top50', 'top100', 'sp500', 'all', 'top20', 'top40', 'top80']).optional()
  .describe('Which names. US: top50, top100 (most traded today), sp500, all (adds popular non-S&P names). Crypto: top20, top40, top80. Default: sp500 / top40.');

const server = new McpServer({ name: 'global-order-flow', version: '2.0.0' });

server.registerTool('get_market_board', {
  title: 'Read the order-flow board',
  description: 'A plain-text brief of the live board: how many names are up, flat and down, every sector\'s median move, and the strongest bullish and bearish readings with their build-up, conviction checks, support and resistance. Start here for "what is the market doing?".',
  inputSchema: { market, window: windowArg, universe, top: z.number().int().min(3).max(40).optional().describe('How many names to list on each side (default 10).') },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ market: m, window: w, universe: u, top }) => {
  const r = await call(`/api/flow/${m}${query({ window: w, universe: u, limit: top, format: 'text' })}`, 'text');
  return r.error ? fail(r.error) : text(r.body);
});

server.registerTool('find_setups', {
  title: 'Find setups on the board',
  description: 'Filter the board, strongest first. Example: bullish US stocks with fresh buying and at least 4 of 5 conviction checks. Build-up codes: crypto LONG_BUILD, SHORT_COVER, SHORT_BUILD, LONG_UNWIND; US ACCUMULATION (bought on heavy volume), DRIFT_UP, DISTRIBUTION (sold on heavy volume), DRIFT_DOWN.',
  inputSchema: {
    market,
    window: windowArg,
    universe,
    side: z.enum(['bullish', 'bearish', 'rangebound']).optional(),
    min_checks: z.number().int().min(0).max(5).optional().describe('Minimum conviction checks that hold (0–5).'),
    build_up: z.array(z.enum(['LONG_BUILD', 'SHORT_COVER', 'SHORT_BUILD', 'LONG_UNWIND', 'ACCUMULATION', 'DRIFT_UP', 'DISTRIBUTION', 'DRIFT_DOWN', 'NEUTRAL'])).optional(),
    fresh_only: z.boolean().optional().describe('Only names with new positions or heavy volume behind the move.'),
    sector: z.string().optional().describe('Sector name, e.g. Technology, Energy, Layer 1, Memes.'),
    limit: z.number().int().min(1).max(100).optional().describe('Default 15.'),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ market: m, window: w, universe: u, side, min_checks, build_up, fresh_only, sector, limit }) => {
  const r = await call(`/api/flow/${m}${query({ window: w, universe: u, side, minChecks: min_checks, buildUp: build_up, fresh: fresh_only ? 'true' : undefined, sector, limit: limit ?? 15 })}`);
  if (r.error) return fail(r.error);
  const b = r.body;
  const rows = (b.results ?? []).map(a => {
    const lv = `support ${a.support?.price ?? 'n/a'}, resistance ${a.resistance?.price ?? 'n/a'}`;
    const extra = a.openInterestChangePct != null ? `OI ${a.openInterestChangePct}%` : a.relativeVolume != null ? `RVOL ${a.relativeVolume}x` : '';
    return `${a.symbol} (${a.sector}) ${a.changePct > 0 ? '+' : ''}${a.changePct}% · ${a.buildUp.label} · ${a.conviction.held}/${a.conviction.counted} checks · ${extra} · ${lv}`;
  });
  return text(`${rows.length} match${rows.length === 1 ? '' : 'es'} on the ${m === 'us' ? 'US' : 'crypto'} board (${b.window} window, as of ${b.asOf}${b.marketOpen === false ? ', market closed' : ''}):\n${rows.join('\n') || 'none'}\n\nReadings for information only, not investment advice.`);
});

server.registerTool('get_symbol', {
  title: 'Read one name in full',
  description: 'Everything the board knows about one stock or coin: its move, side and rank, build-up, each conviction check with the reason, support and resistance (option walls or volume shelves), the zone where positions were added, and open interest, funding or relative volume.',
  inputSchema: { market, symbol: z.string().describe('Ticker, e.g. NVDA, SPY, BRK.B, BTC, SOL.'), window: windowArg },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, async ({ market: m, symbol, window: w }) => {
  const r = await call(`/api/flow/${m}/${encodeURIComponent(symbol.toUpperCase())}${query({ window: w, format: 'text' })}`, 'text');
  return r.error ? fail(r.error) : text(r.body);
});

server.registerTool('get_status', {
  title: 'Is the board running?',
  description: 'Whether the board is running, which markets are loaded, if the US market is open, and when data last refreshed.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  const r = await call('/api/health');
  return r.error ? fail(r.error) : text(JSON.stringify(r.body, null, 2));
});

await server.connect(new StdioServerTransport());
