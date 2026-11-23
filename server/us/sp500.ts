import { sectorIdFromGics } from '../../src/data/sectors';

/**
 * The S&P 500 members and their sectors.
 *
 * The list is kept up to date by the open dataset at
 * github.com/datasets/s-and-p-500-companies (rebuilt from the index's public
 * listing several times a month). The server reads it on start and falls back
 * to the copy bundled in src/data/sp500.json when it is offline.
 */
export const SP500_CSV_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';

export interface Constituent {
  symbol: string; // as quoted by the index: BRK.B
  name: string;
  sector: string; // our sector id
}

/** A small CSV reader: quoted fields, commas and quotes inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

export function parseConstituents(csv: string): Constituent[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const col = (name: string) => header.findIndex(h => h.trim().toLowerCase() === name);
  const iSym = col('symbol');
  const iName = col('security');
  const iSector = col('gics sector');
  if (iSym < 0 || iName < 0 || iSector < 0) throw new Error('unexpected S&P 500 file layout');
  const out: Constituent[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const symbol = r[iSym]?.trim().toUpperCase();
    const sector = sectorIdFromGics(r[iSector] ?? '');
    if (!symbol || !sector || seen.has(symbol) || !/^[A-Z][A-Z0-9.]*$/.test(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name: r[iName].trim(), sector });
  }
  return out;
}

/** Yahoo writes class shares with a dash: BRK.B → BRK-B. */
export const yahooSymbol = (symbol: string) => symbol.replace(/\./g, '-');
