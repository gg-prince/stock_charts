#!/usr/bin/env node
'use strict';
const http = require('http');
const os = require('os');
const { loadEnv } = require('./lib/env');
loadEnv();
const { TIMEFRAMES, EXCHANGE_CODES } = require('./lib/config');
const { loadCache, parseState, query } = require('./lib/data');
const { renderTerminal, renderMarkdown, renderHtml, curlFooter } = require('./lib/render');
const F = require('./lib/format');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLI_UA = /\b(curl|wget|httpie|powershell|windowspowershell|fetch|libcurl)\b/i;
const FORMATS = new Set(['ansi', 'plain', 'md', 'html', 'json']);
const SUFFIX = { plain: 'plain', md: 'md', ansi: 'ansi' };

// Decide the output format.
function chooseMode(req, url, suffix) {
  const q = url.searchParams;
  let mode = suffix || (FORMATS.has(q.get('format')) ? q.get('format') : null);
  const noColor =
    q.has('nocolor') || q.has('NO_COLOR') || 'no-color' in req.headers || 'x-no-color' in req.headers || 'NO_COLOR' in process.env;
  const accept = String(req.headers.accept || '');
  if (!mode) {
    if (CLI_UA.test(req.headers['user-agent'] || '')) mode = 'ansi';
    else if (/text\/plain/i.test(accept) && !/text\/html/i.test(accept)) mode = 'plain';
    else mode = 'html';
  }
  if (mode === 'ansi' && noColor) mode = 'plain';
  return mode;
}

// routes: /1M, /exchange/NSE, /industry/banking, /search/bank, optional trailing /plain|/md|/ansi
function route(pathname) {
  const seg = pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s).slice(0, 60));
  let suffix = null;
  if (seg.length && SUFFIX[seg[seg.length - 1].toLowerCase()]) suffix = SUFFIX[seg.pop().toLowerCase()];
  const params = {};
  const head = (seg[0] || '').toLowerCase();
  if (!seg.length) return { name: 'home', params, suffix };
  if (head === 'health') return { name: 'health' };
  if (head === 'help') return { name: 'help', suffix };
  if (head === 'api' && (seg[1] || '').toLowerCase() === 'stocks') return { name: 'home', params, suffix: 'json' };
  if (TIMEFRAMES.includes(head.toUpperCase()) && seg.length === 1) { params.tf = head.toUpperCase(); return { name: 'home', params, suffix }; }
  if (head === 'exchange' && seg[1] && EXCHANGE_CODES.includes(seg[1].toUpperCase())) { params.exchange = seg[1]; return { name: 'home', params, suffix }; }
  if (head === 'industry' && seg[1]) { params.industry = seg[1]; return { name: 'home', params, suffix }; }
  if (head === 'search' && seg[1]) { params.q = seg.slice(1).join(' '); return { name: 'home', params, suffix }; }
  return { name: 'notfound', suffix };
}

// Very per-IP rate limiter.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) { hits.set(ip, { n: 1, reset: now + 60000 }); return false; }
  return ++rec.n > 120;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, 60000).unref();

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
    'Cache-Control': 'public, max-age=60',
    Vary: 'User-Agent, Accept',
    'X-Served-By': os.hostname(),
    ...extra,
  });
  res.end(body);
}
const TEXT = 'text/plain; charset=utf-8';

function handler(req, res) {
  const started = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  res.on('finish', () => console.log(`${new Date().toISOString()} ${ip} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, TEXT, 'Method not allowed\n', { Allow: 'GET, HEAD' });
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, TEXT, 'Bad request\n'); }
  const r = route(url.pathname);
  if (r.name === 'health') {
    const c = loadCache();
    const body = JSON.stringify({ status: 'ok', host: os.hostname(), cache: c.error ? c.error : 'ok', stocks: c.stocks ? c.stocks.length : 0 });
    return send(res, 200, 'application/json', body, { 'Cache-Control': 'no-store' });
  }
  if (limited(ip)) return send(res, 429, TEXT, 'Too many requests. Slow down.\n', { 'Retry-After': '60' });

  const mode = chooseMode(req, url, r.suffix);
  const color = mode === 'ansi';
  const hostHeader = String(req.headers.host || `localhost:${PORT}`).replace(/[^\w.:\-\[\]]/g, '');
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const base = `${proto}://${hostHeader}`;
  const S = F.makeStyler(color);

  if (r.name === 'notfound') {
    return send(res, 404, TEXT, `Not found.\n${curlFooter(base, null, F.makeStyler(false)).join('\n')}\n`);
  }
  if (r.name === 'help') {
    const help = ['East Africa Stock Screener', '', ...F.wrap('Fastest-growing stocks on the RSE, NSE, DSE and USE. Colour output is for terminals; add /plain for no colour.', 78), '', ...curlFooter(base, null, S)];
    return send(res, 200, TEXT, help.join('\n') + '\n');
  }

  const cache = loadCache();
  if (cache.error) {
    const msg = 'Data not available yet. The background fetcher has not produced a cache file.\n';
    return send(res, 503, TEXT, msg, { 'Retry-After': '300', 'Cache-Control': 'no-store' });
  }
  const get = (k) => (r.params[k] !== undefined ? r.params[k] : url.searchParams.get(k));
  const state = parseState(get);
  const rows = query(cache.stocks, state);
  const result = { meta: cache.meta };

  if (mode === 'json') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ meta: { generated_at: cache.meta.generated_at, demo: !!cache.meta.demo, count: rows.length }, state, data: rows.slice(0, state.limit) }));
  }
  if (mode === 'md') return send(res, 200, 'text/markdown; charset=utf-8', renderMarkdown(result, rows, state, base));
  if (mode === 'html') return send(res, 200, 'text/html; charset=utf-8', renderHtml(result, rows, state, base));
  // plain
  const text = renderTerminal(result, rows, state, { color, width: 80, footer: curlFooter(base, state, S) });
  return send(res, 200, TEXT, text);
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`ea-stocks listening on ${HOST}:${PORT} (${os.hostname()})`));
}
module.exports = { chooseMode, route, handler };
