'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { chooseMode, route } = require('../server');
const { classifyIndustry } = require('../lib/config');
const { parseState, query } = require('../lib/data');
const F = require('../lib/format');

const req = (ua, headers = {}) => ({ headers: { 'user-agent': ua, ...headers } });
const u = (s) => new URL(s, 'http://x');

test('CLI user agents get ANSI, browsers get HTML', () => {
  for (const ua of ['curl/8.5.0', 'Wget/1.21', 'HTTPie/3.2.2', 'WindowsPowerShell/5.1', 'fetch/1.0']) {
    assert.strictEqual(chooseMode(req(ua), u('/'), null), 'ansi', ua);
  }
  assert.strictEqual(chooseMode(req('Mozilla/5.0 Chrome/120'), u('/'), null), 'html');
});

test('overrides: ?format=, suffix routes, Accept and no-colour', () => {
  assert.strictEqual(chooseMode(req('Mozilla/5.0'), u('/?format=plain'), null), 'plain');
  assert.strictEqual(chooseMode(req('Mozilla/5.0'), u('/'), 'md'), 'md');
  assert.strictEqual(chooseMode(req('Mozilla/5.0', { accept: 'text/plain' }), u('/'), null), 'plain');
  assert.strictEqual(chooseMode(req('curl/8', { 'x-no-color': '1' }), u('/'), null), 'plain');
  assert.strictEqual(chooseMode(req('curl/8'), u('/?nocolor=1'), null), 'plain');
  assert.strictEqual(chooseMode(req('curl/8'), u('/?format=html'), null), 'html');
});

test('routes parse timeframe, exchange, industry, search and suffix', () => {
  assert.deepStrictEqual(route('/1m'), { name: 'home', params: { tf: '1M' }, suffix: null });
  assert.strictEqual(route('/exchange/nse/plain').params.exchange, 'nse');
  assert.strictEqual(route('/exchange/nse/plain').suffix, 'plain');
  assert.strictEqual(route('/industry/banking').params.industry, 'banking');
  assert.strictEqual(route('/search/safaricom').params.q, 'safaricom');
  assert.strictEqual(route('/exchange/XXX').name, 'notfound');
  assert.strictEqual(route('/api/stocks').suffix, 'json');
});

test('industry classification', () => {
  assert.strictEqual(classifyIndustry('Banking'), 'Banking & Finance');
  assert.strictEqual(classifyIndustry('Telecommunications'), 'Telecom');
  assert.strictEqual(classifyIndustry('Breweries'), 'Consumer & Breweries');
  assert.strictEqual(classifyIndustry('Energy & Petroleum'), 'Manufacturing & Energy');
  assert.strictEqual(classifyIndustry('???'), 'Other');
});

test('input is whitelisted', () => {
  const s = parseState((k) => ({ tf: '9X', exchange: 'zz', q: '<script>alert(1)</script>', limit: '99999' }[k]));
  assert.strictEqual(s.tf, '1W');
  assert.strictEqual(s.exchange, 'ALL');
  assert.ok(!/[<>()]/.test(s.q));
  assert.strictEqual(s.limit, 200);
});

test('sorting puts highest gain first and missing values last', () => {
  const stocks = [
    { ticker: 'A', name: 'A', exchange: 'NSE', industry: 'Telecom', returns: { '1W': 1 } },
    { ticker: 'B', name: 'B', exchange: 'NSE', industry: 'Telecom', returns: { '1W': null } },
    { ticker: 'C', name: 'C', exchange: 'NSE', industry: 'Telecom', returns: { '1W': 5 } },
  ];
  const rows = query(stocks, { tf: '1W', industry: 'All', exchange: 'ALL', q: '' });
  assert.deepStrictEqual(rows.map((r) => r.ticker), ['C', 'A', 'B']);
});

test('formatting helpers', () => {
  assert.strictEqual(F.sparkline([1, 2, 3, 4, 5, 6, 7]), '▁▂▃▅▆▇█');
  assert.strictEqual(F.fmtPct(1.234), '+1.23%');
  assert.strictEqual(F.fmtPct(null), '—');
  assert.strictEqual(F.stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  assert.ok(F.wrap('word '.repeat(40), 80).every((l) => l.length <= 80));
});