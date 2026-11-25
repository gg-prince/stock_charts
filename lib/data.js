'use strict';
// Reads the pre-computed cache and applies filters
const fs = require('fs');
const { cachePath, EXCHANGE_CODES, TIMEFRAMES, INDUSTRIES } = require('./config');

let memo = { path: null, mtime: 0, value: null };

function loadCache() {
  const p = cachePath();
  let st;
  try { st = fs.statSync(p); } catch { return { error: 'missing', path: p }; }
  if (memo.path === p && memo.mtime === st.mtimeMs) return memo.value;
  let value;
  try {
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!json || !Array.isArray(json.stocks)) throw new Error('bad shape');
    value = { meta: json, stocks: json.stocks };
  } catch {
    value = { error: 'corrupt', path: p };
  }
  memo = { path: p, mtime: st.mtimeMs, value };
  return value;
}

const INDUSTRY_ALIASES = {
  all: 'All', banking: 'Banking & Finance', bank: 'Banking & Finance', finance: 'Banking & Finance',
  telecom: 'Telecom', telecoms: 'Telecom', consumer: 'Consumer & Breweries', breweries: 'Consumer & Breweries',
  manufacturing: 'Manufacturing & Energy', energy: 'Manufacturing & Energy', mfg: 'Manufacturing & Energy',
};
function industryFrom(v) {
  const key = String(v || '').toLowerCase().trim();
  if (INDUSTRY_ALIASES[key]) return INDUSTRY_ALIASES[key];
  return INDUSTRIES.find((i) => i.toLowerCase() === key) || 'All';
}
function industrySlug(name) {
  return { 'Banking & Finance': 'banking', Telecom: 'telecom', 'Consumer & Breweries': 'consumer', 'Manufacturing & Energy': 'manufacturing' }[name] || 'all';
}

// Whitelist-validate user input from query strings / URL paths.
function parseState(get) {
  const tf = String(get('tf') || '1W').toUpperCase();
  const ex = String(get('exchange') || 'ALL').toUpperCase();
  const q = String(get('q') || '').replace(/[^\p{L}\p{N} &.'-]/gu, '').trim().slice(0, 40);
  const limit = Math.min(200, Math.max(1, parseInt(get('limit'), 10) || 25));
  return {
    tf: TIMEFRAMES.includes(tf) ? tf : '1W',
    industry: industryFrom(get('industry')),
    exchange: EXCHANGE_CODES.includes(ex) ? ex : 'ALL',
    q,
    limit,
  };
}

const getReturn = (s, tf) => {
  const v = s.returns && s.returns[tf];
  return typeof v === 'number' && isFinite(v) ? v : null;
};

function query(stocks, state) {
  const q = (state.q || '').toLowerCase();
  const rows = stocks.filter((s) =>
    (state.industry === 'All' || s.industry === state.industry) &&
    (state.exchange === 'ALL' || s.exchange === state.exchange) &&
    (!q || String(s.ticker).toLowerCase().includes(q) || String(s.name).toLowerCase().includes(q)));
  rows.sort((a, b) => {
    const ra = getReturn(a, state.tf);
    const rb = getReturn(b, state.tf);
    if (ra === null && rb === null) return String(a.ticker).localeCompare(String(b.ticker));
    if (ra === null) return 1;
    if (rb === null) return -1;
    return rb - ra;
  });
  return rows;
}

module.exports = { loadCache, parseState, query, getReturn, industryFrom, industrySlug };

