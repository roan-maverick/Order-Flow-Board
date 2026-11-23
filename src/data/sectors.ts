/**
 * US sectors: the 11 GICS sectors the S&P 500 is split into, plus two groups
 * of our own for the index ETFs and for popular names outside the index.
 */
export interface UsSector {
  id: string;
  label: string;
  gics?: string;
}

export const US_SECTORS: UsSector[] = [
  { id: 'tech', label: 'Technology', gics: 'Information Technology' },
  { id: 'comm', label: 'Communication', gics: 'Communication Services' },
  { id: 'discretionary', label: 'Discretionary', gics: 'Consumer Discretionary' },
  { id: 'staples', label: 'Staples', gics: 'Consumer Staples' },
  { id: 'financials', label: 'Financials', gics: 'Financials' },
  { id: 'health', label: 'Health Care', gics: 'Health Care' },
  { id: 'industrials', label: 'Industrials', gics: 'Industrials' },
  { id: 'energy', label: 'Energy', gics: 'Energy' },
  { id: 'materials', label: 'Materials', gics: 'Materials' },
  { id: 'utilities', label: 'Utilities', gics: 'Utilities' },
  { id: 'realestate', label: 'Real Estate', gics: 'Real Estate' },
  { id: 'etf', label: 'Index ETFs' },
  { id: 'popular', label: 'Popular (non-S&P)' },
];

export const sectorIdFromGics = (gics: string): string | null =>
  US_SECTORS.find(s => s.gics?.toLowerCase() === gics.trim().toLowerCase())?.id ?? null;

/** The index ETFs on the US board. SPY is the benchmark every name is compared with. */
export const US_ETFS: Array<[symbol: string, name: string]> = [
  ['SPY', 'S&P 500 ETF'],
  ['QQQ', 'Nasdaq 100 ETF'],
  ['DIA', 'Dow Jones ETF'],
  ['IWM', 'Russell 2000 ETF'],
];

/**
 * Popular names traders follow that are not in the S&P 500. They sit in their
 * own "Popular" group and appear under the "All" universe. Edit freely, or set
 * your own list in flow.config.json. A name that joins the index moves to its
 * S&P 500 sector automatically.
 */
export const US_POPULAR: Array<[symbol: string, name: string]> = [
  ['MSTR', 'Strategy'],
  ['TSM', 'TSMC'],
  ['ARM', 'Arm Holdings'],
  ['ASML', 'ASML'],
  ['SHOP', 'Shopify'],
  ['SOFI', 'SoFi'],
  ['HIMS', 'Hims & Hers'],
  ['RKLB', 'Rocket Lab'],
  ['IONQ', 'IonQ'],
  ['CRWV', 'CoreWeave'],
  ['IREN', 'IREN'],
  ['MARA', 'MARA Holdings'],
  ['RIOT', 'Riot Platforms'],
  ['IBIT', 'iShares Bitcoin ETF'],
];
