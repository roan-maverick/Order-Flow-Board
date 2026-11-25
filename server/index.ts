import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { handleApi, VERSION } from './api';
import { loadConfig, ROOT } from './config';
import { Store } from './store';

/**
 * Global Order Flow: one local server for the board and its API.
 *
 *   npm start      builds the board and serves it with live data
 *   npm run dev    the same, with instant reload while you edit the code
 */
const dev = process.argv.includes('--dev');
const cfg = loadConfig();
if (process.argv.includes('--demo')) cfg.demo = true;
const log = (m: string) => console.log(`${new Date().toLocaleTimeString('en-GB', { hour12: false })}  ${m}`);

const store = new Store(cfg, log);
const dist = resolve(ROOT, 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function send(req: IncomingMessage, res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string> = {}) {
  const gzip = body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const payload = gzip ? gzipSync(body) : Buffer.from(body);
  res.writeHead(status, { 'content-type': type, 'content-length': payload.length, ...(gzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}), ...headers });
  res.end(payload);
}

async function onApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-cache' };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': '*' }); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(req, res, 405, JSON.stringify({ error: 'only GET' }), TYPES['.json'], cors); return; }
  try {
    const r = handleApi(url.pathname, url.searchParams, store, req.headers['if-none-match']);
    const headers: Record<string, string> = { ...cors, ...(r.etag ? { etag: r.etag } : {}) };
    if (r.status === 304) { res.writeHead(304, headers); res.end(); return; }
    if (r.text) send(req, res, r.status, String(r.body), TYPES['.txt'], headers);
    else send(req, res, r.status, JSON.stringify(r.body, null, url.searchParams.has('pretty') ? 2 : 0), TYPES['.json'], headers);
  } catch (e) {
    log(`API error on ${url.pathname}: ${e instanceof Error ? e.stack : e}`);
    send(req, res, 500, JSON.stringify({ error: 'something went wrong; see the server log' }), TYPES['.json'], cors);
  }
}

function onStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    send(req, res, 400, 'Bad request', TYPES['.txt']);
    return;
  }
  let path = normalize(join(dist, decoded));
  if (path !== dist && !path.startsWith(dist + sep)) { send(req, res, 403, 'Forbidden', TYPES['.txt']); return; }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(dist, 'index.html');
  if (!existsSync(path)) {
    send(req, res, 500, 'The board has not been built yet. Run "npm start" (it builds first) or "npm run dev".', TYPES['.txt']);
    return;
  }
  const ext = extname(path);
  const immutable = url.pathname.startsWith('/assets/');
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(path).on('error', () => res.destroy()).pipe(res);
}

async function main() {
  let vite: { middlewares: (req: IncomingMessage, res: ServerResponse, next: () => void) => void; close: () => Promise<void> } | null = null;
  if (dev) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
  } else if (!existsSync(join(dist, 'index.html'))) {
    console.error('\nThe board has not been built yet. Run:  npm start\n');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    // No single request, however malformed, may take the server down.
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) { void onApi(req, res, url); return; }
      if (vite) vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
      else onStatic(req, res, url);
    } catch (e) {
      log(`Bad request ${JSON.stringify(req.url)}: ${e instanceof Error ? e.message : e}`);
      if (!res.headersSent) send(req, res, 400, 'Bad request', TYPES['.txt']);
      else res.destroy();
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') console.error(`\nPort ${cfg.port} is already in use. Close the other app, or start on another port:  PORT=5200 npm start\n`);
    else console.error(e);
    process.exit(1);
  });

  server.listen(cfg.port, cfg.host, () => {
    const shown = cfg.host === '0.0.0.0' || cfg.host === '::' ? 'localhost' : cfg.host === '127.0.0.1' ? 'localhost' : cfg.host;
    const link = `http://${shown}:${cfg.port}`;
    console.log('');
    console.log(`  Global Order Flow ${VERSION}${dev ? ' (dev)' : ''}`);
    console.log(`  Board  →  ${link}`);
    console.log(`  API    →  ${link}/api`);
    console.log(`  Data   →  ${cfg.demo ? 'demo market (simulated)' : [cfg.us.enabled && 'US stocks (S&P 500)', cfg.crypto.enabled && 'crypto perpetuals'].filter(Boolean).join(' + ')}`);
    console.log('');
  });

  await store.start();

  const shutdown = async () => {
    store.stop();
    await vite?.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
