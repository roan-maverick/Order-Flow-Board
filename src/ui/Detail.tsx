import { useEffect, useRef } from 'react';
import type { Flow, FlowAsset } from '../model/flow';
import { Candles } from './Candles';
import { compact, compactUsd, price, signedPct, signedPrice } from './format';

interface Props {
  flow: Flow;
  asset: FlowAsset;
  onClose: () => void;
  timeZone?: string;
}

export function Detail({ flow, asset: a, onClose, timeZone }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const sc = a.side === 'bullish' ? 'bull' : a.side === 'bearish' ? 'bear' : 'flat';
  const isCrypto = flow.market === 'crypto';
  const sideWord = a.side === 'bullish' ? 'Bullish' : a.side === 'bearish' ? 'Bearish' : 'Rangebound';
  const levelKind = a.support?.kind ?? a.resistance?.kind;

  return (
    <div className="overlay" onClick={onClose}>
      <div className={`detail side-${sc}`} role="dialog" aria-label={`${a.symbol} detail`} tabIndex={-1} ref={ref} onClick={e => e.stopPropagation()}>
        <header>
          <div className="id">
            <h2>{a.symbol}</h2>
            <span className="nm">{a.name} · {a.sectorLabel}</span>
          </div>
          <div className="quote">
            <span className="pct">{signedPct(a.changePct)}</span>
            <span className="px">{price(a.price)} <em>{signedPrice(a.price - a.base)}</em></span>
          </div>
          <span className={`badge ${sc}`}>{sideWord}</span>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <p className="lede">
          {a.side === 'rangebound'
            ? <>Moved less than ±{flow.window.floor}% {flow.window.scope}, so it sits on the zero bar.</>
            : <>{a.buildUp.label} {flow.window.scope}. Rank <b>#{a.rank}</b> of {a.side === 'bullish' ? flow.bullish.length : flow.bearish.length} {a.side}; <b>{a.checksHeld} of {a.checksCounted}</b> checks of conviction hold.</>}
        </p>

        <div className="chartbox">
          <Candles candles={a.candles} width={700} height={250} max={96} support={a.support} resistance={a.resistance} zone={a.zone} detailed timeZone={timeZone} />
          <div className="legend">
            <span><i className="sw sup" />Support {levelKind === 'options' ? '(put wall)' : levelKind === 'volume' ? '(volume shelf)' : ''}</span>
            <span><i className="sw res" />Resistance {levelKind === 'options' ? '(call wall)' : levelKind === 'volume' ? '(volume shelf)' : ''}</span>
            {a.zone && <span><i className="sw zone" />Zone: where the most {isCrypto ? 'open interest was added' : 'volume traded'} with the move</span>}
          </div>
        </div>

        <div className="cols">
          <section>
            <h3>Why it ranks here</h3>
            <ul className="checks">
              {a.checks.map(c => (
                <li key={c.id} className={c.pass == null ? 'na' : c.pass ? 'ok' : 'no'}>
                  <i>{c.pass == null ? '–' : c.pass ? '✓' : '✕'}</i>
                  <div><b>{c.label}</b><span>{c.note}</span></div>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Readings</h3>
            <dl className="stats">
              <dt>Build-up</dt><dd>{a.buildUp.label}</dd>
              {isCrypto ? <>
                <dt>Open interest</dt><dd>{compactUsd(a.oiValue)} <em>{signedPct(a.oiChangePct)}</em></dd>
                <dt>Funding</dt><dd>{a.funding == null ? '—' : `${(a.funding * 100).toFixed(4)}%`}</dd>
                <dt>Taker buys</dt><dd>{a.takerBuyShare == null ? '—' : `${(a.takerBuyShare * 100).toFixed(1)}% of volume`}</dd>
              </> : <>
                <dt>Relative volume</dt><dd>{a.rvol == null ? '—' : `${a.rvol.toFixed(2)}×`}</dd>
                <dt>Call / put volume</dt><dd>{a.callPutRatio == null ? '—' : a.callPutRatio.toFixed(2)}</dd>
                <dt>Volume (window)</dt><dd>{compact(a.candles.reduce((s, c) => s + c.v, 0))}</dd>
              </>}
              <dt>Support</dt><dd>{a.support ? <>{price(a.support.price)} <em>{signedPct(a.support.distancePct)}</em></> : '—'}</dd>
              <dt>Resistance</dt><dd>{a.resistance ? <>{price(a.resistance.price)} <em>{signedPct(a.resistance.distancePct)}</em></> : '—'}</dd>
              <dt>Zone</dt><dd>{a.zone ? `${price(a.zone.low)} – ${price(a.zone.high)}` : '—'}</dd>
              <dt>Sector</dt><dd>{a.sectorLabel}</dd>
            </dl>
          </section>
        </div>
        <footer>Readings, not advice. {flow.source}{flow.note ? ` · ${flow.note}` : ''}.</footer>
      </div>
    </div>
  );
}
