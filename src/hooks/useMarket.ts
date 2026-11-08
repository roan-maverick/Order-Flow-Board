import { useEffect, useRef, useState } from 'react';
import type { MarketData, MarketId } from '../data/types';
import { loadCrypto, type CryptoFeed } from '../data/crypto';
import { loadUs } from '../data/us';
import { demoCrypto, demoUs } from '../data/demo';

export interface MarketState {
  data: MarketData | null;
  loading: boolean;
  /** Why the board fell back to the demo market, when it did. */
  fallback: string | null;
  updatedAt: number | null;
}

const CRYPTO_REFRESH = 60_000;
const US_REFRESH = 5 * 60_000;
const DEMO_TICK = 30_000;
export const CRYPTO_FETCH = 80;

/** Loads a market and keeps it fresh; falls back to the demo market if no source answers. */
export function useMarket(market: MarketId): MarketState {
  const [state, setState] = useState<MarketState>({ data: null, loading: true, fallback: null, updatedAt: null });
  const feedRef = useRef<CryptoFeed | null>(null);
  const dataRef = useRef<MarketData | null>(null);
  dataRef.current = state.data;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setState({ data: null, loading: true, fallback: null, updatedAt: null });
    feedRef.current = null;

    const demo = (reason: string) => {
      const make = () => (market === 'crypto' ? demoCrypto(Date.now(), 60) : demoUs(Date.now()));
      if (cancelled) return;
      setState({ data: make(), loading: false, fallback: reason, updatedAt: Date.now() });
      timer = setInterval(() => !cancelled && setState(s => ({ ...s, data: make(), updatedAt: Date.now() })), DEMO_TICK);
    };

    const forceDemo = new URLSearchParams(location.search).has('demo');
    if (forceDemo) {
      demo('demo requested');
      return () => { cancelled = true; clearInterval(timer); };
    }

    if (market === 'crypto') {
      loadCrypto(CRYPTO_FETCH)
        .then(({ data, feed }) => {
          if (cancelled) return;
          feedRef.current = feed;
          setState({ data, loading: false, fallback: null, updatedAt: Date.now() });
          timer = setInterval(async () => {
            const feed = feedRef.current;
            if (!feed) return;
            const current = dataRef.current;
            if (!current) return;
            try {
              const next = await feed.refresh(current);
              if (!cancelled) setState(s => ({ ...s, data: next, updatedAt: Date.now() }));
            } catch { /* keep the last board */ }
          }, CRYPTO_REFRESH);
        })
        .catch(e => demo(`live feed unreachable (${e instanceof Error ? e.message : e})`));
    } else {
      loadUs()
        .then(data => {
          if (cancelled) return;
          setState({ data, loading: false, fallback: null, updatedAt: Date.now() });
          timer = setInterval(() => {
            loadUs().then(next => !cancelled && setState(s => ({ ...s, data: next, updatedAt: Date.now() }))).catch(() => {});
          }, US_REFRESH);
        })
        .catch(e => demo(`no US file yet (${e instanceof Error ? e.message : e})`));
    }
    return () => { cancelled = true; clearInterval(timer); };
  }, [market]);

  return state;
}
