import type { MarketId } from '../src/data/types';
import { BUILDUPS, WINDOWS, type BuildUpCode, type Side, type WindowId } from '../src/model/flow';
import { assetJson, assetText, boardJson, boardText, type Filters } from '../src/model/report';
import { UNIVERSES, universeDef, type UniverseId } from '../src/model/universe';
import type { Store } from './store';

/**
 * The JSON API. Everything the board shows is available here, for bots,
 * notebooks, spreadsheets and AI agents.
 *
 *   GET /api/health                         is it running, what is loaded
 *   GET /api/flow/us                        the whole US board
 *   GET /api/flow/us?side=bullish&minChecks=4&limit=10    filtered setups
 *   GET /api/flow/us?format=text            a plain-text brief for an AI chat
 *   GET /api/flow/us/NVDA                   one name, with its 5-minute candles
 *   GET /api/market/us                      the raw market file the board draws
 */
export interface ApiResponse {
  status: number;
  body: unknown;
  text?: boolean;
  etag?: string;
}

export const VERSION = '2.0.0';

const isMarket = (m: string): m is MarketId => m === 'us' || m === 'crypto';

function error(status: number, message: string, extra: Record<string, unknown> = {}): ApiResponse {
  return { status, body: { error: message, ...extra } };
}

export function handleApi(path: string, query: URLSearchParams, store: Store, ifNoneMatch?: string): ApiResponse {
  const parts = path.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) {
    return {
      status: 200,
      body: {
        name: 'Global Order Flow API',
        version: VERSION,
        endpoints: {
          '/api/health': 'what is loaded and when it last refreshed',
          '/api/flow/{us|crypto}': 'the board: sectors, every name with its side, build-up, checks and levels',
          '/api/flow/{market}?side=bullish&minChecks=4&limit=10': 'filtered setups (also: buildUp, sector, fresh=true)',
          '/api/flow/{market}?format=text': 'a plain-text brief to paste into an AI chat',
          '/api/flow/{market}/{SYMBOL}': 'one name in full, with 5-minute candles',
          '/api/market/{market}': 'the raw market file the board is drawn from',
        },
        parameters: {
          window: { us: WINDOWS.us.map(w => w.id), crypto: WINDOWS.crypto.map(w => w.id) },
          universe: { us: UNIVERSES.us.map(u => u.id), crypto: UNIVERSES.crypto.map(u => u.id) },
          side: ['bullish', 'bearish', 'rangebound'],
          buildUp: Object.keys(BUILDUPS),
        },
      },
    };
  }

  if (parts[0] === 'health') {
    const us = store.snapshot('us');
    const crypto = store.snapshot('crypto');
    return { status: 200, body: { ok: true, version: VERSION, time: new Date().toISOString(), markets: { us: { ...us.status, names: us.data?.assets.length ?? 0 }, crypto: { ...crypto.status, names: crypto.data?.assets.length ?? 0 } } } };
  }

  const market = parts[1];
  if ((parts[0] === 'market' || parts[0] === 'flow') && (!market || !isMarket(market))) return error(404, 'use /us or /crypto, e.g. /api/flow/us');

  if (parts[0] === 'market' && market && isMarket(market)) {
    const snap = store.snapshot(market);
    const etag = `"${snap.version}"`;
    if (!snap.data) return { status: 503, body: { status: snap.status, data: null }, etag };
    if (ifNoneMatch === etag) return { status: 304, body: null, etag };
    return { status: 200, body: { status: snap.status, data: snap.data }, etag };
  }

  if (parts[0] === 'flow' && market && isMarket(market)) {
    const windowId = (query.get('window') ?? WINDOWS[market][0].id) as WindowId;
    if (!WINDOWS[market].some(w => w.id === windowId)) return error(400, `window must be one of ${WINDOWS[market].map(w => w.id).join(', ')}`);
    const universeParam = query.get('universe');
    if (universeParam && !UNIVERSES[market].some(u => u.id === universeParam)) return error(400, `universe must be one of ${UNIVERSES[market].map(u => u.id).join(', ')}`);
    const universe = universeDef(market, universeParam).id as UniverseId;
    const result = store.flow(market, windowId, universe);
    if (!result) {
      const snap = store.snapshot(market);
      return error(503, snap.status.message ?? 'still loading, try again shortly', { status: snap.status });
    }
    const { flow, snapshot } = result;
    const meta = { universe: universeDef(market, universe).label, marketOpen: snapshot.data?.marketOpen, sessionDate: snapshot.data?.sessionDate };
    const text = query.get('format') === 'text';

    if (parts[2]) {
      const symbol = parts[2].toUpperCase();
      const asset = flow.assets.find(a => a.symbol === symbol) ?? store.flow(market, windowId, 'all' as UniverseId)?.flow.assets.find(a => a.symbol === symbol);
      if (!asset) return error(404, `${symbol} is not on the ${market} board`);
      return text ? { status: 200, body: assetText(asset, flow), text: true } : { status: 200, body: { ...meta, window: windowId, asOf: new Date(flow.asOf).toISOString(), ...assetJson(asset, true) } };
    }

    const filters: Filters = {};
    const side = query.get('side');
    if (side) {
      if (!['bullish', 'bearish', 'rangebound'].includes(side)) return error(400, 'side must be bullish, bearish or rangebound');
      filters.side = side as Side;
    }
    const minChecks = query.get('minChecks');
    if (minChecks != null) {
      const n = Number(minChecks);
      if (!Number.isInteger(n) || n < 0 || n > 5) return error(400, 'minChecks must be a whole number from 0 to 5');
      filters.minChecks = n;
    }
    const buildUp = query.get('buildUp');
    if (buildUp) {
      const codes = buildUp.split(',').map(s => s.trim().toUpperCase()) as BuildUpCode[];
      const bad = codes.filter(c => !(c in BUILDUPS));
      if (bad.length) return error(400, `unknown buildUp ${bad.join(', ')}; use ${Object.keys(BUILDUPS).join(', ')}`);
      filters.buildUp = codes;
    }
    if (query.get('sector')) filters.sector = query.get('sector')!;
    if (query.get('fresh') === 'true') filters.fresh = true;
    const limit = query.get('limit');
    if (limit != null) {
      const n = Number(limit);
      if (!Number.isInteger(n) || n < 1) return error(400, 'limit must be a whole number above 0');
      filters.limit = n;
    }
    if (text) return { status: 200, body: boardText(flow, meta, filters.limit ?? 10), text: true };
    return { status: 200, body: boardJson(flow, meta, filters) };
  }

  return error(404, `no such endpoint: ${path}. See /api for the list.`);
}
