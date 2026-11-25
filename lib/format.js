'use strict';
// Terminal formatting helpers.
const ESC = '\x1b[';
const CODES = { bold: '1', dim: '2', red: '31', green: '32', yellow: '33', cyan: '36', gray: '90', inverse: '7' };
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

function makeStyler(color) {
  const f = (name) => (s) => (color ? `${ESC}${CODES[name]}m${s}${ESC}0m` : String(s));
  return Object.fromEntries(Object.keys(CODES).map((k) => [k, f(k)]));
}
const stripAnsi = (s) => String(s).replace(ANSI_RE, '');
const visLen = (s) => [...stripAnsi(s)].length;

function pad(s, w, align = 'left') {
  const n = visLen(s);
  if (n >= w) return s;
  const sp = ' '.repeat(w - n);
  return align === 'right' ? sp + s : s + sp;
}
function truncate(s, w) {
  const a = [...String(s)];
  return a.length <= w ? String(s) : a.slice(0, Math.max(0, w - 1)).join('') + '…';
}

const BLOCKS = '▁▂▃▄▅▆▇█';
function sparkline(values, width = 7) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const v = values.slice(-width);
  const min = Math.min(...v);
  const max = Math.max(...v);
  return v
    .map((x) => (max === min ? BLOCKS[3] : BLOCKS[Math.round(((x - min) / (max - min)) * (BLOCKS.length - 1))]))
    .join('');
}

function wrap(text, width = 80) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (!line) line = word;
    else if (visLen(line) + 1 + visLen(word) <= width) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

function fmtPrice(p, cur) {
  if (typeof p !== 'number' || !isFinite(p)) return '—';
  const d = Math.abs(p) >= 1000 ? 0 : 2;
  return `${cur} ${p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function fmtPct(v) {
  return typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
}
function ago(iso) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return 'unknown';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 2) return 'just now';
  if (m < 120) return `${m} min ago`;
  if (m < 2880) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { makeStyler, stripAnsi, visLen, pad, truncate, sparkline, wrap, fmtPrice, fmtPct, ago, escapeHtml };
