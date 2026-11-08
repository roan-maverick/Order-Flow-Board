/**
 * The colours, in one place. They are written to CSS variables for the page,
 * and passed to the SVG as presentation attributes, so a saved image (which
 * cannot see the stylesheet) looks exactly like the screen.
 */
export type Theme = 'light' | 'dark';

export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  line2: string;
  grid: string;
  bull: string;
  bullInk: string;
  bullLine: string;
  bullSoft: string;
  bullRgb: string;
  bear: string;
  bearInk: string;
  bearLine: string;
  bearSoft: string;
  bearRgb: string;
  flat: string;
  bench: string;
  shadow: string;
  shadowHot: string;
}

export const PALETTES: Record<Theme, Palette> = {
  light: {
    bg: '#f3f4f6', panel: '#ffffff', panel2: '#f8f9fb', ink: '#0b0d12', ink2: '#3a3f4b', muted: '#7a808c',
    line: '#e4e6eb', line2: '#eef0f3', grid: '#eceef2',
    bull: '#0f9f4f', bullInk: '#087a3b', bullLine: '#19b25c', bullSoft: '#e9f7ef', bullRgb: '22 163 74',
    bear: '#e0314b', bearInk: '#b81c35', bearLine: '#ec4561', bearSoft: '#fdedf0', bearRgb: '225 49 75',
    flat: '#9aa1ad', bench: '#0b0d12',
    shadow: '0 1px 2px rgba(16, 24, 40, 0.04), 0 2px 8px rgba(16, 24, 40, 0.04)', shadowHot: '0 6px 24px rgba(16, 24, 40, 0.14)',
  },
  dark: {
    bg: '#07090c', panel: '#0f1217', panel2: '#131720', ink: '#eef0f4', ink2: '#c3c8d2', muted: '#7d8492',
    line: '#1e232c', line2: '#171b22', grid: '#161a21',
    bull: '#2fd27a', bullInk: '#47e08d', bullLine: '#2fd27a', bullSoft: '#0d2419', bullRgb: '47 210 122',
    bear: '#ff4d6a', bearInk: '#ff6b83', bearLine: '#ff4d6a', bearSoft: '#2a0f16', bearRgb: '255 77 106',
    flat: '#5b6270', bench: '#ffffff',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.4)', shadowHot: '0 8px 30px rgba(0, 0, 0, 0.6)',
  },
};

const VARS: Array<[keyof Palette, string]> = [
  ['bg', '--bg'], ['panel', '--panel'], ['panel2', '--panel-2'], ['ink', '--ink'], ['ink2', '--ink-2'], ['muted', '--muted'],
  ['line', '--line'], ['line2', '--line-2'], ['grid', '--grid'],
  ['bull', '--bull'], ['bullInk', '--bull-ink'], ['bullLine', '--bull-line'], ['bullSoft', '--bull-soft'], ['bullRgb', '--bull-tile'],
  ['bear', '--bear'], ['bearInk', '--bear-ink'], ['bearLine', '--bear-line'], ['bearSoft', '--bear-soft'], ['bearRgb', '--bear-tile'],
  ['flat', '--flat'], ['bench', '--bench'], ['shadow', '--shadow'], ['shadowHot', '--shadow-hot'],
];

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const p = PALETTES[theme];
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const [key, name] of VARS) root.style.setProperty(name, p[key]);
}

export const FONT = "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export const sideColor = (p: Palette, side: 'bullish' | 'bearish' | 'rangebound') => (side === 'bullish' ? p.bullLine : side === 'bearish' ? p.bearLine : p.flat);
export const sideInk = (p: Palette, side: 'bullish' | 'bearish' | 'rangebound') => (side === 'bullish' ? p.bullInk : side === 'bearish' ? p.bearInk : p.muted);
