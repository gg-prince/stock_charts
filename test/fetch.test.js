'use strict';
// Runs fetch-data.js against a local mock of the Mansa API (no internet or real key needed).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const iso = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

test('fetch-data builds returns from stored history and survives missing exchanges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-'));
  const cache = path.join(dir, 'ea-stocks.json');
  // Pre-seed history: NSE:AAA was 100 a week ago, 50 a month ago.
  fs.writeFileSync(path.join(dir, 'ea-stocks-history.json'), JSON.stringify({
    version: 1, requests: { date: iso(0), count: 0 },
    series: { 'NSE:AAA': { [iso(30)]: 50, [iso(7)]: 100, [iso(1)]: 110 } },
  }));
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    assert.match(req.headers.authorization || '', /^Bearer test-key$/);
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.includes('/exchanges/NSE/')) return send(200, { success: true, data: [{ ticker: 'aaa', company_name: 'Alpha Bank', sector: 'Banking', price: '120', change_pct: 9.09 }, { ticker: 'BAD', price: null }] });
    if (req.url.includes('/exchanges/DSE/')) return send(200, { data: { stocks: [{ symbol: 'ZZZ', name: 'Zed Telecom', sector: 'Telecommunications', last_price: 2000 }] } });
    return send(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, r));
  const env = { ...process.env, MANSA_API_KEY: 'test-key', MANSA_BASE_URL: `http://127.0.0.1:${server.address().port}`, EA_CACHE: cache };
  const out = await new Promise((resolve) => {
    const p = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'fetch-data.js')], { env });
    let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
    p.on('close', (code) => resolve({ code, log }));
  });
  server.close();
  assert.strictEqual(out.code, 0, out.log);
  const data = JSON.parse(fs.readFileSync(cache, 'utf8'));
  assert.deepStrictEqual(data.missing_exchanges.sort(), ['RSE', 'USE']);
  const a = data.stocks.find((s) => s.ticker === 'AAA');
  assert.strictEqual(a.industry, 'Banking & Finance');
  assert.strictEqual(a.currency, 'KES');
  assert.strictEqual(a.returns['1W'], 20);      // 100 -> 120
  assert.strictEqual(a.returns['1M'], 140);     // 50 -> 120
  assert.strictEqual(a.returns['1Y'], null);    // not enough history yet
  assert.strictEqual(a.returns['1D'], 9.09);    // taken from the API
  assert.ok(a.spark.length >= 3);
  assert.ok(!data.stocks.some((s) => s.ticker === 'BAD'));
  const z = data.stocks.find((s) => s.ticker === 'ZZZ');
  assert.strictEqual(z.exchange, 'DSE');
  assert.strictEqual(z.returns['1W'], null);
  assert.strictEqual(calls, 4, 'exactly one request per exchange');
});

test('fetch-data keeps the old cache when the API key is rejected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-'));
  const cache = path.join(dir, 'ea-stocks.json');
  fs.writeFileSync(cache, JSON.stringify({ stocks: [{ ticker: 'OLD' }] }));
  const server = http.createServer((req, res) => { res.writeHead(401); res.end('{}'); });
  await new Promise((r) => server.listen(0, r));
  const env = { ...process.env, MANSA_API_KEY: 'bad', MANSA_BASE_URL: `http://127.0.0.1:${server.address().port}`, EA_CACHE: cache };
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'fetch-data.js')], { env, encoding: 'utf8' }).status;
  server.close();
  assert.notStrictEqual(res, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(cache, 'utf8')).stocks[0].ticker, 'OLD');
});