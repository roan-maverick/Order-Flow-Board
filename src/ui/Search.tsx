import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetSeries } from '../data/types';

/** Find any name on the board. Press "/" anywhere to jump here. */
export function Search({ assets, onPick }: { assets: AssetSeries[]; onPick: (symbol: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === '/' && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const matches = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return [];
    const exact = assets.filter(a => a.symbol === s);
    const starts = assets.filter(a => a.symbol !== s && a.symbol.startsWith(s));
    const rest = assets.filter(a => !a.symbol.startsWith(s));
    const nameStarts = rest.filter(a => a.name.toUpperCase().startsWith(s));
    const named = rest.filter(a => !a.name.toUpperCase().startsWith(s) && a.name.toUpperCase().includes(s));
    return [...exact, ...starts, ...nameStarts, ...named].slice(0, 8);
  }, [q, assets]);

  const choose = (symbol: string) => {
    onPick(symbol);
    setQ('');
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="search">
      <input
        ref={input}
        value={q}
        placeholder="Search ticker  /"
        aria-label="Search a ticker or company"
        spellCheck={false}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && matches[active]) choose(matches[active].symbol);
          else if (e.key === 'Escape') { setQ(''); input.current?.blur(); }
        }}
      />
      {open && matches.length > 0 && (
        <ul role="listbox">
          {matches.map((a, i) => (
            <li key={a.symbol} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={() => choose(a.symbol)} onMouseEnter={() => setActive(i)}>
              <b>{a.symbol}</b><span>{a.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
