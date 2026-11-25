#!/usr/bin/env node
'use strict';
const readline = require('readline');
const { loadEnv } = require('./lib/env');
loadEnv();
const { TIMEFRAMES, INDUSTRIES, EXCHANGE_CODES } = require('./lib/config');
const { loadCache, query } = require('./lib/data');
const { renderTerminal } = require('./lib/render');
const F = require('./lib/format');

const out = process.stdout;
const state = { tf: '1W', industry: 'All', exchange: 'ALL', q: '', limit: 200 };
let offset = 0;
let searching = false;
let draft = '';
let idle;

function cycle(list, cur) { return list[(list.indexOf(cur) + 1) % list.length]; }

function frame() {
  const S = F.makeStyler(true);
  const width = Math.max(60, out.columns || 80);
  const height = out.rows || 24;
  const cache = loadCache();
  if (cache.error) {
    return `${S.bold('EAST AFRICA STOCK SCREENER')}\n\nNo data yet. The background fetcher has not written a cache file.\nTry again in a few minutes.\n\n${S.dim('q quit')}\n`;
  }
  const rows = query(cache.stocks, state);
  const reserved = 12; // header + notices + table header + footer
  const maxRows = Math.max(2, Math.floor((height - reserved) / 2));
  offset = Math.min(offset, Math.max(0, rows.length - maxRows));
  const hint = searching
    ? `Search: ${S.bold(draft)}${S.inverse(' ')}   ${S.dim('Enter apply · Esc cancel')}`
    : S.dim(`[t] timeframe ${state.tf}  [i] industry  [e] exchange  [/] search${state.q ? ` "${state.q}"` : ''}  [↑↓] scroll  [q] quit`);
  return renderTerminal({ meta: cache.meta }, rows, state, { color: true, width, offset, maxRows, footer: [hint] });
}

function draw() {
  out.write('\x1b[H\x1b[2J' + frame().replace(/\n/g, '\r\n'));
  clearTimeout(idle);
  idle = setTimeout(() => quit('Session timed out.'), 15 * 60 * 1000);
}

function restore() { out.write('\x1b[?25h\x1b[?1049l'); }
function quit(msg) {
  restore();
  if (msg) out.write(msg + '\n');
  process.exit(0);
}

// Non-interactive fallback : print once and exit.
if (!process.stdin.isTTY || !out.isTTY) {
  const cache = loadCache();
  if (cache.error) { console.log('No data available yet.'); process.exit(0); }
  process.stdout.write(renderTerminal({ meta: cache.meta }, query(cache.stocks, state), state, { color: false, width: 80, maxRows: 25 }));
  process.exit(0);
}

out.write('\x1b[?1049h\x1b[?25l');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((s) => process.on(s, () => quit()));
process.on('uncaughtException', (e) => { restore(); console.error('Unexpected error:', e.message); process.exit(1); });
out.on('resize', draw);
setInterval(draw, 60000).unref();

process.stdin.on('keypress', (str, key = {}) => {
  if (key.ctrl && key.name === 'c') return quit();
  if (searching) {
    if (key.name === 'return') { state.q = draft.trim(); searching = false; offset = 0; }
    else if (key.name === 'escape') { searching = false; draft = state.q; }
    else if (key.name === 'backspace') draft = draft.slice(0, -1);
    else if (str && /^[\p{L}\p{N} &.'-]$/u.test(str) && draft.length < 40) draft += str;
    return draw();
  }
  switch (key.name || str) {
    case 'q': return quit('Goodbye.');
    case 't': state.tf = cycle(TIMEFRAMES, state.tf); offset = 0; break;
    case 'i': state.industry = cycle(INDUSTRIES, state.industry); offset = 0; break;
    case 'e': state.exchange = cycle(['ALL', ...EXCHANGE_CODES], state.exchange); offset = 0; break;
    case '/': case 'slash': searching = true; draft = state.q; break;
    case 'escape': state.q = ''; offset = 0; break;
    case 'up': case 'k': offset = Math.max(0, offset - 1); break;
    case 'down': case 'j': offset += 1; break;
    case 'pageup': offset = Math.max(0, offset - 10); break;
    case 'pagedown': offset += 10; break;
    default: return;
  }
  draw();
});
draw();
