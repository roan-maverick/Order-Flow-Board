import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { BRAND } from './config';
import type { MarketId } from './data/types';
import { useMarket, type MarketState } from './hooks/useMarket';
import { buildFlow, WINDOWS, type Flow, type WindowId } from './model/flow';
import { boardText } from './model/report';
import { selectUniverse, UNIVERSES, universeDef, type UniverseId } from './model/universe';
import { Board } from './ui/Board';
import { Detail } from './ui/Detail';
import { MobileBoard } from './ui/MobileBoard';
import { Search } from './ui/Search';
import { H, W } from './ui/geometry';
import { clock, dayLabel, zoneName } from './ui/format';
import { applyTheme, PALETTES, type Theme } from './ui/palette';
import { PaletteContext, usePalette } from './ui/usePalette';

const MARKETS: Array<{ id: MarketId; label: string; long: string }> = [
  { id: 'us', label: 'US Stocks', long: 'US stocks' },
  { id: 'crypto', label: 'Crypto', long: 'Crypto perpetual futures' },
];

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

function initial() {
  const q = new URLSearchParams(location.search);
  const market: MarketId = (q.get('m') ?? read('gof.market')) === 'crypto' ? 'crypto' : 'us';
  const win = q.get('w') ?? read(`gof.window.${market}`);
  const uni = q.get('u') ?? read(`gof.universe.${market}`);
  const t = q.get('theme') ?? read('gof.theme');
  const theme: Theme = t === 'dark' || t === 'light' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return { market, win, uni, theme };
}

const pickWindow = (m: MarketId, w: string | null): WindowId => (WINDOWS[m].some(x => x.id === w) ? (w as WindowId) : WINDOWS[m][0].id);

function useWide(min = 820) {
  const [wide, setWide] = useState(() => innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(innerWidth >= min);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, [min]);
  return wide;
}

/** Re-renders every 30 s, for "updated 2 min ago". */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function App() {
  const init = useMemo(initial, []);
  const [market, setMarket] = useState<MarketId>(init.market);
  const [windowId, setWindowId] = useState<WindowId>(() => pickWindow(init.market, init.win));
  const [universe, setUniverse] = useState<UniverseId>(() => universeDef(init.market, init.uni).id);
  const [theme, setTheme] = useState<Theme>(init.theme);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverSector, setHoverSector] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const wide = useWide();
  const now = useNow();
  const state = useMarket(market);

  useLayoutEffect(() => {
    applyTheme(theme);
    write('gof.theme', theme);
  }, [theme]);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('m', market);
    q.set('w', windowId);
    q.set('u', universe);
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
    write('gof.market', market);
    write(`gof.window.${market}`, windowId);
    write(`gof.universe.${market}`, universe);
  }, [market, windowId, universe]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const switchMarket = (m: MarketId) => {
    if (m === market) return;
    setMarket(m);
    setPinned(null);
    setHover(null);
    setWindowId(pickWindow(m, read(`gof.window.${m}`)));
    setUniverse(universeDef(m, read(`gof.universe.${m}`)).id);
  };

  const flow = useMemo<Flow | null>(() => {
    if (!state.data) return null;
    return buildFlow(state.data, windowId, { symbols: selectUniverse(state.data, universe) });
  }, [state.data, windowId, universe]);

  const timeZone = market === 'us' ? 'America/New_York' : undefined;
  const pinnedAsset = flow && pinned ? flow.assets.find(a => a.symbol === pinned) ?? null : null;

  const pick = useCallback((symbol: string) => {
    if (flow && !flow.assets.some(a => a.symbol === symbol)) setUniverse(market === 'us' ? 'all' : 'top80');
    setPinned(symbol);
  }, [flow, market]);

  // Fit the fixed-size board to the screen.
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1.6, el.clientWidth / (W + 48)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wide, flow != null]);

  const saveImage = useCallback(async () => {
    if (!frameRef.current) return;
    setBusy('image');
    try {
      const url = await toPng(frameRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: PALETTES[theme].bg,
        filter: node => !(node instanceof HTMLElement && node.classList.contains('hint')),
      });
      const link = document.createElement('a');
      link.download = `global-order-flow-${market}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
      link.href = url;
      link.click();
    } catch (e) {
      console.error(e);
      setToast('Could not make the image in this browser. A screenshot works just as well.');
    } finally {
      setBusy(null);
    }
  }, [market, theme]);

  const copyForAi = useCallback(async () => {
    if (!flow) return;
    const text = boardText(flow, { universe: universeDef(market, universe).label, marketOpen: state.data?.marketOpen, sessionDate: state.data?.sessionDate });
    try {
      await navigator.clipboard.writeText(text);
      setToast('Copied. Paste it into ChatGPT, Claude or any AI chat and ask your question.');
    } catch {
      setToast('Your browser blocked the clipboard. Open /api/flow/' + market + '?format=text instead.');
    }
  }, [flow, market, universe, state.data]);

  const marketLong = MARKETS.find(m => m.id === market)!.long;
  const sessionLabel = state.data?.sessionDate ? dayLabel(Date.parse(`${state.data.sessionDate}T16:00:00Z`), 'UTC') : flow ? dayLabel(flow.asOf, timeZone) : '';

  return (
    <PaletteContext.Provider value={PALETTES[theme]}>
      <div className="app">
        <header className="topbar">
          <a className="brand" href={BRAND.repoUrl} target="_blank" rel="noreferrer">
            <Logo />
            <span><b>{BRAND.name}</b><em>by {BRAND.author}</em></span>
          </a>
          <div className="controls">
            <Segmented value={market} options={MARKETS.map(m => ({ value: m.id, label: m.label }))} onChange={switchMarket} strong />
            <Segmented value={windowId} options={WINDOWS[market].map(w => ({ value: w.id, label: w.label, title: w.scope }))} onChange={v => setWindowId(v)} />
            <Segmented value={universe} options={UNIVERSES[market].map(u => ({ value: u.id, label: u.label, title: u.hint }))} onChange={v => setUniverse(v)} />
          </div>
          <div className="actions">
            {flow && <Search assets={state.data?.assets ?? []} onPick={pick} />}
            {wide && <button className="btn" onClick={copyForAi} disabled={!flow} title="Copy the board as text for an AI chat">Copy for AI</button>}
            {wide && <button className="btn" onClick={saveImage} disabled={!flow || busy === 'image'}>{busy === 'image' ? 'Saving…' : 'Save image'}</button>}
            <button className="btn icon" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Toggle theme" title="Toggle theme">{theme === 'light' ? '☾' : '☀'}</button>
          </div>
        </header>

        <StatusBar market={market} state={state} now={now} timeZone={timeZone} />

        <main>
          {!flow && <Loading market={market} state={state} />}
          {flow && wide && (
            <div className="stage" ref={stageRef} style={{ height: (H + 92) * scale }}>
              <div className="scaler" style={{ transform: `scale(${scale})`, width: W + 48 }}>
                <div className="frame" ref={frameRef}>
                  <div className="frame-head">
                    <span className="fb"><Logo /><b>{BRAND.name}</b></span>
                    <span className="t"><b>{marketLong}</b> · {universeDef(market, universe).label} · {sessionLabel}{timeZone ? ` · times in ${zoneName(timeZone)}` : ''}</span>
                    <span className="hint">Hover any line, tile or sector · click for the full reading · press / to search</span>
                    <span className="u">{BRAND.repoUrl.replace('https://', '')}</span>
                  </div>
                  <Board flow={flow} hot={hover ?? pinned} hotSector={hoverSector} onHover={setHover} onHoverSector={setHoverSector} onPick={setPinned} timeZone={timeZone} />
                </div>
              </div>
            </div>
          )}
          {flow && !wide && <MobileBoard flow={flow} onPick={setPinned} timeZone={timeZone} />}
        </main>

        <footer className="foot">
          <p>
            <b>How to read it.</b> Every name starts at 0% at the beginning of the window. Names going up rise above the zero line and run through the green tunnel; names going down fall below it through the red one; names that barely moved end on the middle bar. {market === 'crypto'
              ? 'For crypto, the build-up label compares price with open interest (how many futures positions are open): long build-up = price up and new positions; short covering = price up as shorts close; short build-up = price down and new positions; long unwinding = price down as longs close.'
              : 'For stocks, the build-up label compares the move with relative volume (today’s volume against what the stock normally trades by this time). Support and resistance are the strikes with the most option open interest: the put wall below, the call wall above.'}
          </p>
          <p className="muted">
            Data: {market === 'crypto' ? 'Binance, Bybit or OKX public market data; Deribit options for BTC and ETH.' : 'Yahoo Finance 5-minute bars and Cboe delayed options, fetched by your local server. Prices can be a few minutes behind.'} For information only, not investment advice.
            {' '}Free and open source (MIT): <a href={BRAND.repoUrl} target="_blank" rel="noreferrer">{BRAND.repoUrl.replace('https://', '')}</a>.
            {' '}Board idea inspired by <a href="https://github.com/MrChartist/order-flow" target="_blank" rel="noreferrer">Order Flow</a> by Mr. Chartist (Indian F&amp;O).
          </p>
        </footer>

        {flow && pinnedAsset && <Detail flow={flow} asset={pinnedAsset} onClose={() => setPinned(null)} timeZone={timeZone} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </PaletteContext.Provider>
  );
}

function StatusBar({ market, state, now, timeZone }: { market: MarketId; state: MarketState; now: number; timeZone?: string }) {
  if (state.fallback) {
    const msg = state.via === 'demo' && state.fallback === 'no local server'
      ? <>This is the <b>simulated demo market</b>. For live {market === 'us' ? 'S&P 500' : 'crypto'} data, start the board with <code>npm start</code> (see the README).</>
      : state.fallback === 'demo requested'
        ? <>This is the <b>simulated demo market</b> (prices are made up). Remove <code>?demo</code> from the address for live data.</>
        : <>This is the <b>simulated demo market</b> because live data could not be loaded: {state.fallback.replace(/\.+$/, '')}.</>;
    return <div className="statusbar demo"><span>{msg}</span></div>;
  }
  if (!state.data) return null;
  if (state.status?.mode === 'demo') {
    return <div className="statusbar demo"><span>This is the <b>simulated demo market</b> (made-up prices). For live data, stop it and run <code>npm start</code>.</span></div>;
  }
  const d = state.data;
  const ago = state.updatedAt ? Math.max(0, Math.round((now - (state.status?.lastRefresh ?? state.updatedAt)) / 60_000)) : null;
  const updated = ago == null ? '' : ago < 1 ? 'updated just now' : `updated ${ago} min ago`;
  if (market === 'us') {
    const open = d.marketOpen;
    return (
      <div className={`statusbar ${open ? 'open' : 'closed'}`}>
        <span className="dot" />
        {open ? <b>Market open</b> : <b>Market closed</b>}
        <span>{open ? 'live session' : 'showing the last session'}: {d.sessionDate ? dayLabel(Date.parse(`${d.sessionDate}T16:00:00Z`), 'UTC') : ''}, bars to {clock(d.asOf, timeZone)} {zoneName(timeZone)}</span>
        <span className="muted">{d.assets.length} names · {updated}{state.status?.optionsLoaded ? ` · option walls for ${state.status.optionsLoaded}` : ''}</span>
      </div>
    );
  }
  return (
    <div className="statusbar open">
      <span className="dot" />
      <b>Live</b>
      <span>{d.source} · {d.assets.length} perpetuals · trading 24/7</span>
      <span className="muted">{updated}</span>
    </div>
  );
}

function Loading({ market, state }: { market: MarketId; state: MarketState }) {
  const s = state.status;
  const share = s?.total ? Math.min(1, (s.loaded ?? 0) / s.total) : 0;
  return (
    <div className="loading">
      {s?.phase === 'loading' && s.total ? (
        <>
          <p className="big">Loading the S&amp;P 500</p>
          <div className="progress"><i style={{ width: `${(share * 100).toFixed(1)}%` }} /></div>
          <p>{s.loaded} of {s.total} names. The first start takes a minute or two; after that the board opens instantly.</p>
        </>
      ) : (
        <>
          <div className="spinner" />
          <p>{market === 'crypto' ? 'Reading the most-traded perpetual futures…' : 'Connecting to the local server…'}</p>
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, strong }: { value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; strong?: boolean }) {
  return (
    <div className={`seg${strong ? ' strong' : ''}`} role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" title={o.title} aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Logo() {
  const pal = usePalette();
  return (
    <svg className="logo" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill={pal.ink} />
      <path d="M5 16 C10 16 11 8 16 8 L20 8 C23 8 24 6 27 6" fill="none" stroke="#22c55e" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M5 16 C10 16 11 24 16 24 L20 24 C23 24 24 26 27 26" fill="none" stroke="#f43f5e" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M5 16 L27 16" stroke={pal.bg} strokeOpacity={0.5} strokeWidth={1.4} strokeDasharray="2 2" />
    </svg>
  );
}
