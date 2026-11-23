import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { US_POPULAR } from '../src/data/sectors';

/**
 * Settings. Everything has a sensible default; to change something, copy
 * flow.config.example.json to flow.config.json and edit it, or set an
 * environment variable (they win over the file).
 */
export interface FlowConfig {
  port: number;
  /** 127.0.0.1 keeps the board on your computer. 0.0.0.0 opens it to your network. */
  host: string;
  us: {
    enabled: boolean;
    refreshMinutes: number;
    popular: Array<[string, string]>;
    optionWalls: boolean;
    /** Option walls for the N most-traded names; the rest use volume shelves. */
    optionsTop: number;
    optionsHours: number;
    concurrency: number;
  };
  crypto: {
    enabled: boolean;
    /** How many perpetuals to load (ranked by 24h volume). */
    count: number;
    refreshSeconds: number;
    /** auto tries Binance, then Bybit, then Gate.io; or pin one: binance, bybit, gate. */
    exchange: 'auto' | 'binance' | 'bybit' | 'gate';
  };
  /** Serve the simulated market instead of live data. */
  demo: boolean;
  cacheDir: string;
  /** Load a saved market file instead of fetching (for offline work and tests). */
  usFile: string | null;
  cryptoFile: string | null;
}

export const ROOT = resolve(import.meta.dirname, '..');

const DEFAULTS: FlowConfig = {
  port: 5199,
  host: '127.0.0.1',
  us: { enabled: true, refreshMinutes: 3, popular: US_POPULAR, optionWalls: true, optionsTop: 100, optionsHours: 8, concurrency: 6 },
  crypto: { enabled: true, count: 80, refreshSeconds: 60, exchange: 'auto' },
  demo: false,
  cacheDir: resolve(ROOT, '.cache'),
  usFile: null,
  cryptoFile: null,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, file = resolve(ROOT, 'flow.config.json')): FlowConfig {
  let fromFile: DeepPartial<FlowConfig> = {};
  try {
    fromFile = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`flow.config.json is not valid JSON: ${(e as Error).message}`);
  }
  const cfg: FlowConfig = {
    ...DEFAULTS,
    ...fromFile,
    us: { ...DEFAULTS.us, ...fromFile.us },
    crypto: { ...DEFAULTS.crypto, ...fromFile.crypto },
  } as FlowConfig;
  const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  cfg.port = num(env.PORT) ?? cfg.port;
  cfg.host = env.HOST ?? cfg.host;
  if (env.FLOW_DEMO === '1' || env.FLOW_DEMO === 'true') cfg.demo = true;
  if (env.FLOW_US === '0') cfg.us.enabled = false;
  if (env.FLOW_CRYPTO === '0') cfg.crypto.enabled = false;
  cfg.us.refreshMinutes = Math.max(1, num(env.FLOW_US_REFRESH_MINUTES) ?? cfg.us.refreshMinutes);
  cfg.crypto.count = Math.min(150, Math.max(5, num(env.FLOW_CRYPTO_COUNT) ?? cfg.crypto.count));
  cfg.usFile = env.FLOW_US_FILE ? resolve(env.FLOW_US_FILE) : cfg.usFile;
  cfg.cryptoFile = env.FLOW_CRYPTO_FILE ? resolve(env.FLOW_CRYPTO_FILE) : cfg.cryptoFile;
  if (env.FLOW_CACHE_DIR) cfg.cacheDir = resolve(env.FLOW_CACHE_DIR);
  return cfg;
}
