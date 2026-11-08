import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { BRAND } from './config';
import type { MarketId } from './data/types';
import { US_ASSETS } from './data/universe';
import { useMarket } from './hooks/useMarket';
import { buildFlow, WINDOWS, type WindowId } from './model/flow';
import { Board } from './ui/Board';
import { Detail } from './ui/Detail';
import { MobileBoard } from './ui/MobileBoard';
import { H, W } from './ui/geometry';
import { dayLabel, zoneName } from './ui/format';
import { applyTheme, PALETTES, type Theme } from './ui/palette';
import { PaletteContext, usePalette } from './ui/usePalette';


const MARKETS: Array<{ id: MarketId; label: string; long: string }> = [
  { id: 'crypto', label: 'Crypto Perps', long: 'Crypto perpetual futures' },
  { id: 'us', label: 'US Stocks', long: 'US stocks & ETFs' },
];

const UNIVERSES: Record<MarketId, Array<{ n: number; label: string }>> = {
  crypto: [{ n: 40, label: 'Top 40' }, { n: 80, label: 'Top 80' }],
  us: [{ n: 40, label: 'Top 40' }, { n: US_ASSETS.length, label: `All ${US_ASSETS.length}` }],
};

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

function initial() {
  const q = new URLSearchParams(location.search);
  const market = (q.get('m') ?? read('gof.market')) === 'us' ? 'us' : 'crypto';
  const win = q.get('w') ?? read(`gof.window.${market}`);
  const theme = (q.get('theme') ?? read('gof.theme')) === 'dark' ? 'dark' : (q.get('theme') ?? read('gof.theme')) === 'light' ? 'light' : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return { market: market as MarketId, win, theme: theme as Theme };
}

function useWide(min = 820) {
  const [wide, setWide] = useState(() => innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(innerWidth >= min);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, [min]);
  return wide;
}

export function App() {
  const init = useMemo(initial, []);
  const [market, setMarket] = useState<MarketId>(init.market);
  const [windowId, setWindowId] = useState<WindowId>(() => (WINDOWS[init.market].some(w => w.id === init.win) ? init.win as WindowId : WINDOWS[init.market][0].id));
  const [universe, setUniverse] = useState<number>(() => Number(read(`gof.universe.${init.market}`)) || UNIVERSES[init.market][0].n);
  const [theme, setTheme] = useState<Theme>(init.theme);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverSector, setHoverSector] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const wide = useWide();
  const state = useMarket(market);

  useLayoutEffect(() => {
    applyTheme(theme);
    write('gof.theme', theme);
  }, [theme]);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('m', market);
    q.set('w', windowId);
    history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
    write('gof.market', market);
    write(`gof.window.${market}`, windowId);
    write(`gof.universe.${market}`, String(universe));
  }, [market, windowId, universe]);

  const switchMarket = (m: MarketId) => {
    if (m === market) return;
    setMarket(m);
    setPinned(null);
    const w = read(`gof.window.${m}`);
    setWindowId(WINDOWS[m].some(x => x.id === w) ? w as WindowId : WINDOWS[m][0].id);
    setUniverse(Number(read(`gof.universe.${m}`)) || UNIVERSES[m][0].n);
  };

  const flow = useMemo(() => {
    if (!state.data) return null;
    const symbols = new Set(state.data.assets.slice(0, universe).map(a => a.symbol));
    return buildFlow(state.data, windowId, { symbols });
  }, [state.data, windowId, universe]);

  const timeZone = market === 'us' ? 'America/New_York' : undefined;
  const pinnedAsset = flow && pinned ? flow.assets.find(a => a.symbol === pinned) ?? null : null;

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

  const share = useCallback(async () => {
    if (!frameRef.current) return;
    setSharing(true);
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
      alert('Could not make the image in this browser. A screenshot works just as well.');
    } finally {
      setSharing(false);
    }
  }, [market, theme]);

  const marketLong = MARKETS.find(m => m.id === market)!.long;

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
          <Segmented value={windowId} options={WINDOWS[market].map(w => ({ value: w.id, label: w.label }))} onChange={v => setWindowId(v)} />
          <Segmented value={universe} options={UNIVERSES[market].map(u => ({ value: u.n, label: u.label }))} onChange={v => setUniverse(v)} />
        </div>
        <div className="actions">
          {wide && <button className="btn" onClick={share} disabled={!flow || sharing}>{sharing ? 'Saving…' : 'Save image'}</button>}
          <button className="btn icon" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Toggle theme" title="Toggle theme">{theme === 'light' ? '☾' : '☀'}</button>
        </div>
      </header>

      {state.fallback && (
        <div className="notice" title={state.fallback}>
          {market === 'crypto'
            ? 'The exchanges’ live feed is not reachable from your network, so this is the simulated demo market.'
            : 'The US market file has not been built yet, so this is a simulated demo session.'}
        </div>
      )}

      <main>
        {!flow && (
          <div className="loading">
            <div className="spinner" />
            <p>{market === 'crypto' ? 'Reading the most-traded perpetuals from the exchanges…' : 'Loading the US session…'}</p>
          </div>
        )}
        {flow && wide && (
          <div className="stage" ref={stageRef} style={{ height: (H + 92) * scale }}>
            <div className="scaler" style={{ transform: `scale(${scale})`, width: W + 48 }}>
              <div className="frame" ref={frameRef}>
                <div className="frame-head">
                  <span className="fb"><Logo /><b>{BRAND.name}</b></span>
                  <span className="t"><b>{marketLong}</b> · {dayLabel(flow.asOf, timeZone)}{timeZone ? ` · times in ${zoneName(timeZone)}` : ''}</span>
                  <span className="hint">Hover any line, tile or sector · click for the full reading</span>
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
          <b>How to read it.</b> Every name is drawn from 0% at the start of the window. Bulls rise above the zero line and run through the green tunnel, bears fall below through the red one, flat names end on the bar. {market === 'crypto'
            ? 'Build-up reads price against perpetual open interest: long build-up (price ↑ OI ↑), short covering (↑ ↓), short build-up (↓ ↑), long unwinding (↓ ↓).'
            : 'US stocks have no single-stock futures, so build-up reads price against relative volume (today’s volume against its usual pace for the time of day). Levels are the heaviest listed option open interest: put wall below, call wall above.'}
        </p>
        <p className="muted">
          Data: {market === 'crypto' ? 'Binance / Bybit public APIs, Deribit options (BTC, ETH), read live in your browser.' : 'Yahoo Finance 5-minute bars and Cboe delayed options, refreshed every 15 minutes in market hours.'} Readings, not investment advice.
          {' '}Open source (MIT) at <a href={BRAND.repoUrl} target="_blank" rel="noreferrer">{BRAND.repoUrl.replace('https://', '')}</a>.
          {' '}Board concept inspired by <a href="https://github.com/MrChartist/order-flow" target="_blank" rel="noreferrer">Order Flow</a> by Mr. Chartist for Indian F&amp;O.
        </p>
      </footer>

      {flow && pinnedAsset && <Detail flow={flow} asset={pinnedAsset} onClose={() => setPinned(null)} timeZone={timeZone} />}
    </div>
    </PaletteContext.Provider>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, strong }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; strong?: boolean }) {
  return (
    <div className={`seg${strong ? ' strong' : ''}`} role="tablist">
      {options.map(o => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
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
