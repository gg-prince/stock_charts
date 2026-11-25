#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env');
loadEnv();
const { EXCHANGES, EXCHANGE_CODES, classifyIndustry, cachePath, historyPath } = require('./lib/config');

const BASE = process.env.MANSA_BASE_URL || 'https://mansaapi.com';
const MAX_REQ = parseInt(process.env.MAX_REQUESTS_PER_DAY, 10) || 90;
const today = () => new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toISOString(), ...a);

// file processing
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p); // readers never see a half-written file
}

// API client with a daily request handling 
let budget = { date: today(), count: 0 };
async function api(pathname, params = {}) {
  if (!process.env.MANSA_API_KEY) throw new Error('MANSA_API_KEY is not set');
  if (budget.date !== today()) budget = { date: today(), count: 0 };
  if (budget.count >= MAX_REQ) throw new Error(`Daily request budget reached (${MAX_REQ})`);
  const url = new URL(pathname, BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  for (let attempt = 1; attempt <= 2; attempt++) {
    budget.count++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.MANSA_API_KEY}`, Accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 404) return { notFound: true };
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('API key rejected or tier too low'), { fatal: true });
      if (res.status === 429) throw Object.assign(new Error('API rate limit hit (429)'), { fatal: true });
      if (res.status >= 500 && attempt === 1) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}`);
      return await res.json();
    } catch (e) {
      if (e.fatal || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    } finally { clearTimeout(timer); }
  }
}

//normalization (field names tolerate small API variations)
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v; return typeof n === 'number' && isFinite(n) ? n : null; };
function extractList(body) {
  const d = body && body.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.stocks)) return d.stocks;
  if (d && Array.isArray(d.results)) return d.results;
  if (Array.isArray(body)) return body;
  return [];
}
function normalize(raw, exchange) {
  const ticker = raw.ticker || raw.symbol;
  const price = num(raw.price ?? raw.close ?? raw.last_price ?? raw.last);
  if (!ticker || price === null) return null;
  return {
    ticker: String(ticker).toUpperCase(),
    name: String(raw.name || raw.company_name || raw.company || ticker),
    exchange,
    industry: classifyIndustry(raw.sector || raw.industry),
    currency: EXCHANGES[exchange].currency,
    price,
    volume: num(raw.volume),
    change_1d: num(raw.change_pct ?? raw.change_percentage ?? raw.changePercent),
  };
}

//history + returns
function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Latest stored close on/before target, no older than `tolerance` days before it.
function closeNear(series, target, tolerance) {
  const dates = Object.keys(series).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] <= target) return addDays(target, -tolerance) <= dates[i] ? series[dates[i]] : null;
  }
  return null;
}
function computeReturns(series, nowPrice, change1d) {
  const t = today();
  const pct = (base) => (base ? ((nowPrice - base) / base) * 100 : null);
  const prev = closeNear(series, addDays(t, -1), 5);
  return {
    '1D': change1d !== null ? change1d : pct(prev),
    '1W': pct(closeNear(series, addDays(t, -7), 4)),
    '1M': pct(closeNear(series, addDays(t, -30), 6)),
    '1Y': pct(closeNear(series, addDays(t, -365), 12)),
  };
}
function sparkFrom(series) {
  const dates = Object.keys(series).sort().slice(-7);
  return dates.map((d) => series[d]);
}

async function backfill(history, stocks) {
  
  const need = stocks.filter((s) => Object.keys(history.series[`${s.exchange}:${s.ticker}`] || {}).length < 5);
  for (const s of need) {
    if (budget.count >= MAX_REQ - 2) break;
    const code = process.env[`MANSA_CODE_${s.exchange}`] || s.exchange;
    try {
      const body = await api(`/api/v1/markets/exchanges/${code}/stocks/${encodeURIComponent(s.ticker)}/history`, { range: '1Y' });
      const pts = (body && body.data && body.data.points) || [];
      const series = history.series[`${s.exchange}:${s.ticker}`] || (history.series[`${s.exchange}:${s.ticker}`] = {});
      pts.forEach((p) => { const c = num(p.close ?? p.adj_close); if (p.date && c !== null) series[p.date] = c; });
    } catch (e) { log(`backfill stopped: ${e.message}`); break; }
  }
}

//demo data (fictional; clearly flagged)
function demo() {
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const sectors = ['Banking', 'Telecommunications', 'Consumer Goods', 'Manufacturing', 'Energy', 'Insurance', 'Breweries'];
  const names = { Banking: 'Bank', Telecommunications: 'Telecom', 'Consumer Goods': 'Foods', Manufacturing: 'Industries', Energy: 'Energy', Insurance: 'Insurance', Breweries: 'Breweries' };
  const places = { RSE: 'Kigali', NSE: 'Nairobi', DSE: 'Dar', USE: 'Kampala' };
  const stocks = [];
  EXCHANGE_CODES.forEach((ex, ei) => {
    sectors.forEach((sec, si) => {
      if (rnd() < 0.15) return;
      const base = [120, 15, 2200, 480][ei] * (0.4 + rnd() * 3);
      const drift = (rnd() - 0.42) * 0.004;
      let p = base; const closes = [];
      for (let d = 0; d < 366; d++) { p *= 1 + drift + (rnd() - 0.5) * 0.03; closes.push(p); }
      const at = (n) => closes[closes.length - 1 - n];
      const pct = (n) => ((at(0) - at(n)) / at(n)) * 100;
      stocks.push({
        ticker: `${ex[0]}${places[ex].slice(0, 2).toUpperCase()}${si + 1}`,
        name: `${places[ex]} Demo ${names[sec]}`, exchange: ex, industry: classifyIndustry(sec),
        currency: EXCHANGES[ex].currency, price: +at(0).toFixed(2), volume: Math.round(rnd() * 90000),
        returns: { '1D': pct(1), '1W': pct(7), '1M': pct(30), '1Y': pct(365) }, spark: closes.slice(-7).map((v) => +v.toFixed(2)),
      });
    });
  });
  return { version: 1, generated_at: new Date().toISOString(), demo: true, source: 'demo', history_days: 366, missing_exchanges: [], errors: [], stocks };
}

// main
async function main() {
  const out = cachePath(true);
  if (process.argv.includes('--demo')) {
    writeAtomic(out, demo());
    log(`Demo cache written to ${out}`);
    return;
  }
  const hp = historyPath();
  const history = readJson(hp, { version: 1, requests: budget, series: {} });
  budget = history.requests && history.requests.date === today() ? history.requests : { date: today(), count: 0 };

  const stocks = [];
  const missing = [];
  const errors = [];
  for (const ex of EXCHANGE_CODES) {
    const code = process.env[`MANSA_CODE_${ex}`] || ex;
    try {
      const body = await api(`/api/v1/markets/exchanges/${code}/stocks`, { limit: 200 });
      if (body.notFound) { missing.push(ex); log(`${ex}: not covered by the API`); continue; }
      const list = extractList(body).map((r) => normalize(r, ex)).filter(Boolean);
      if (!list.length) { missing.push(ex); log(`${ex}: API returned no usable rows`); continue; }
      stocks.push(...list);
      log(`${ex}: ${list.length} stocks`);
    } catch (e) {
      errors.push(`${ex}: ${e.message}`);
      log(`${ex}: ${e.message}`);
      if (e.fatal) break; // bad key / rate limit: stop wasting requests
    }
  }

  if (!stocks.length) {
    log('No data fetched; keeping the previous cache untouched.');
    history.requests = budget; writeAtomic(hp, history);
    process.exitCode = 1;
    return;
  }

  const t = today();
  stocks.forEach((s) => {
    const key = `${s.exchange}:${s.ticker}`;
    (history.series[key] = history.series[key] || {})[t] = s.price;
  });
  if (process.env.MANSA_HISTORY_BACKFILL === '1') await backfill(history, stocks);

  // remoove old history
  const cutoff = addDays(t, -400);
  Object.values(history.series).forEach((ser) => Object.keys(ser).forEach((d) => { if (d < cutoff) delete ser[d]; }));
  history.requests = budget;
  writeAtomic(hp, history);

  const days = new Set();
  Object.values(history.series).forEach((ser) => Object.keys(ser).forEach((d) => days.add(d)));
  const final = stocks.map((s) => {
    const series = history.series[`${s.exchange}:${s.ticker}`];
    const { change_1d, ...rest } = s;
    return { ...rest, returns: computeReturns(series, s.price, change_1d), spark: sparkFrom(series) };
  });
  writeAtomic(out, {
    version: 1, generated_at: new Date().toISOString(), demo: false, source: 'Mansa API (mansaapi.com)',
    history_days: days.size, missing_exchanges: missing, errors, stocks: final,
  });
  log(`Wrote ${final.length} stocks to ${out}. Requests today: ${budget.count}/${MAX_REQ}`);
}

main().catch((e) => { console.error('fetch-data failed:', e.message); process.exit(1); });

