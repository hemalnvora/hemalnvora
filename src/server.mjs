// Zero-config server for a VPS: serves the board, refreshes the data on a timer.
//   PORT                  default 8080
//   REFRESH_EVERY_HOURS   live F1/MotoGP feeds + rebuild, default 3
//   RESEARCH_EVERY_HOURS  Claude web research for the other series, default 24 (needs ANTHROPIC_API_KEY)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { refresh, DATA_DIR } from './refresh.mjs';
import { buildDocument } from './page.mjs';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_MS = Number(process.env.REFRESH_EVERY_HOURS || 3) * 3600e3;
const RESEARCH_MS = Number(process.env.RESEARCH_EVERY_HOURS || 24) * 3600e3;
const canResearch = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const log = (...a) => console.log(new Date().toISOString(), ...a);

let data = null;
let running = null;

async function loadLatest() {
  try {
    data = JSON.parse(await readFile(path.join(DATA_DIR, 'latest.json'), 'utf8'));
  } catch {
    data = null;
  }
}

async function lastResearchAt() {
  try {
    return (await stat(path.join(DATA_DIR, 'researched.json'))).mtimeMs;
  } catch {
    return 0;
  }
}

async function tick() {
  if (running) return running;
  running = (async () => {
    const age = data ? Date.now() - Date.parse(data.generatedAt) : Infinity;
    const research = canResearch && Date.now() - (await lastResearchAt()) > RESEARCH_MS;
    if (age < REFRESH_MS && !research) return;
    log(`refreshing${research ? ' with web research' : ''}`);
    try {
      data = await refresh({ research, log: (m) => log(m) });
      log(`refreshed: ${data.series.length} series`);
    } catch (err) {
      log('refresh failed:', err.message);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await buildDocument(data || { series: [], buzz: { items: [] } });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(html);
    }
    if (url.pathname === '/data.json') {
      res.writeHead(data ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
      return res.end(JSON.stringify(data || { error: 'not ready' }));
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: Boolean(data), generatedAt: data?.generatedAt ?? null, researchEnabled: canResearch }));
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    log('request failed:', err.message);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error');
  }
});

await loadLatest();
server.listen(PORT, HOST, () => log(`Paddock & Pavilion on http://${HOST}:${PORT} (research ${canResearch ? 'on' : 'off: set ANTHROPIC_API_KEY to enable'})`));
tick();
setInterval(tick, 10 * 60 * 1000);
