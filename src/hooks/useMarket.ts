import { useEffect, useRef, useState } from 'react';
import type { MarketData, MarketId } from '../data/types';
import { loadCrypto, type CryptoFeed } from '../data/crypto';
import { demoCrypto, demoUs } from '../data/demo';

/** What the local server says about a market (loading progress, market hours, …). */
export interface ServerStatus {
  mode: 'live' | 'demo' | 'file' | 'off';
  phase: 'starting' | 'loading' | 'ready' | 'error' | 'off';
  message: string | null;
  loaded?: number;
  total?: number;
  marketOpen?: boolean;
  sessionDate?: string | null;
  lastRefresh?: number | null;
  nextRefresh?: number | null;
  optionsLoaded?: number;
}

export interface MarketState {
  data: MarketData | null;
  /** Where the data came from: the local server, the exchanges directly (no server), or the demo. */
  via: 'server' | 'direct' | 'demo' | null;
  status: ServerStatus | null;
  /** Why the board is showing the demo market, when it is. */
  fallback: string | null;
  updatedAt: number | null;
}

const POLL_LOADING = 2_500;
const POLL_READY: Record<MarketId, number> = { crypto: 30_000, us: 60_000 };
const DIRECT_REFRESH = 60_000;
const DEMO_TICK = 30_000;
const DIRECT_COUNT = 80;

const empty: MarketState = { data: null, via: null, status: null, fallback: null, updatedAt: null };

/**
 * Loads a market and keeps it fresh.
 *  1. From the local server (npm start), which does the heavy lifting.
 *  2. Without a server (the page hosted on its own): crypto straight from the exchanges.
 *  3. Otherwise the simulated demo market, with a note saying why.
 */
export function useMarket(market: MarketId): MarketState {
  const [state, setState] = useState<MarketState>(empty);
  const dataRef = useRef<MarketData | null>(null);
  dataRef.current = state.data;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let etag: string | null = null;
    setState(empty);

    const later = (fn: () => void, ms: number) => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(fn, ms);
    };

    const demo = (reason: string) => {
      if (cancelled) return;
      const make = () => (market === 'crypto' ? demoCrypto(Date.now(), 60) : demoUs(Date.now()));
      setState({ data: make(), via: 'demo', status: null, fallback: reason, updatedAt: Date.now() });
      const tick = () => {
        setState(s => ({ ...s, data: make(), updatedAt: Date.now() }));
        later(tick, DEMO_TICK);
      };
      later(tick, DEMO_TICK);
    };

    const direct = async (why: string) => {
      if (market !== 'crypto') return demo(why);
      let feed: CryptoFeed;
      try {
        const loaded = await loadCrypto(DIRECT_COUNT);
        if (cancelled) return;
        feed = loaded.feed;
        setState({ data: loaded.data, via: 'direct', status: null, fallback: null, updatedAt: Date.now() });
      } catch (e) {
        return demo(`the exchanges are not reachable from this network (${e instanceof Error ? e.message : e})`);
      }
      const tick = async () => {
        const current = dataRef.current;
        if (current) {
          try {
            const next = await feed.refresh(current);
            if (!cancelled) setState(s => ({ ...s, data: next, updatedAt: Date.now() }));
          } catch { /* keep the last board */ }
        }
        later(tick, DIRECT_REFRESH);
      };
      later(tick, DIRECT_REFRESH);
    };

    const poll = async () => {
      let res: Response;
      try {
        res = await fetch(`${import.meta.env.BASE_URL}api/market/${market}`, { headers: etag ? { 'if-none-match': etag } : {}, cache: 'no-store' });
      } catch {
        if (dataRef.current) return later(poll, POLL_READY[market]); // the server blinked; keep the board
        return direct('no local server');
      }
      if (cancelled) return;
      const type = res.headers.get('content-type') ?? '';
      if (res.status === 304) return later(poll, POLL_READY[market]);
      if (!type.includes('json')) {
        // No API here: the page is hosted on its own (or the dev server runs without the API).
        if (dataRef.current) return;
        return direct('no local server');
      }
      const body = (await res.json()) as { status: ServerStatus; data: MarketData | null };
      if (cancelled) return;
      etag = res.headers.get('etag');
      if (body.data) {
        setState({ data: body.data, via: 'server', status: body.status, fallback: null, updatedAt: Date.now() });
        return later(poll, body.status.phase === 'loading' ? POLL_LOADING * 2 : POLL_READY[market]);
      }
      if (body.status.phase === 'error' || body.status.phase === 'off') {
        return demo(body.status.message ?? 'the server could not load this market');
      }
      setState(s => ({ ...s, status: body.status, via: 'server' }));
      later(poll, POLL_LOADING);
    };

    if (new URLSearchParams(location.search).has('demo')) demo('demo requested');
    else void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [market]);

  return state;
}
