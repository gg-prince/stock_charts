'use strict';
// Turns query results into terminal text (ANSI / plain)
const { EXCHANGES, INDUSTRY_SHORT, TIMEFRAMES, INDUSTRIES, EXCHANGE_CODES } = require('./config');
const F = require('./format');
const { getReturn, industrySlug } = require('./data');

const TF_LABEL = { '1D': '1 Day', '1W': '1 Week', '1M': '1 Month', '1Y': '1 Year' };

function notices(meta, tf) {
  const out = [];
  if (meta.demo) out.push('DEMO DATA: fictional companies and prices for testing only.');
  if (!meta.demo && meta.history_days !== undefined) {
    const need = { '1D': 1, '1W': 7, '1M': 30, '1Y': 365 }[tf];
    if (meta.history_days < need && tf !== '1D') {
      out.push(`Building history: ${meta.history_days} day(s) stored; ${tf} returns appear after ~${need} days.`);
    }
  }
  if (meta.missing_exchanges && meta.missing_exchanges.length) {
    out.push(`No data from the API for: ${meta.missing_exchanges.join(', ')}.`);
  }
  return out;
}

function columns(width) {
  const fixed = { ticker: 8, exch: 4, ind: 10, price: 13, chg: 8, trend: 7 };
  const gaps = 6;
  const used = Object.values(fixed).reduce((a, b) => a + b, 0) + gaps;
  return { ...fixed, name: Math.min(34, Math.max(12, width - used)) };
}

function headerLines(result, state, S, width) {
  const { meta } = result;
  const lines = [];
  lines.push(S.bold(S.cyan('EAST AFRICA STOCK SCREENER')) + S.dim('  RSE · NSE · DSE · USE'));
  const sub = `Fastest growers by % gain · ${TF_LABEL[state.tf]} · ${state.industry === 'All' ? 'All industries' : state.industry} · ${state.exchange === 'ALL' ? 'All exchanges' : state.exchange}${state.q ? ` · search "${state.q}"` : ''}`;
  F.wrap(sub, width).forEach((l) => lines.push(l));
  const src = meta.demo ? 'demo dataset' : meta.source || 'Mansa API';
  lines.push(S.dim(`Data: ${src} · updated ${F.ago(meta.generated_at)}`));
  notices(meta, state.tf).forEach((n) => F.wrap(n, width).forEach((l) => lines.push(S.yellow(l))));
  return lines;
}

function tableLines(rows, state, S, width, offset = 0, maxRows = rows.length, rowGap = 1) {
  const c = columns(width);
  const lines = [];
  const head =
    F.pad('TICKER', c.ticker) + ' ' + F.pad('COMPANY', c.name) + ' ' + F.pad('EXCH', c.exch) + ' ' +
    F.pad('INDUSTRY', c.ind) + ' ' + F.pad('PRICE', c.price, 'right') + ' ' + F.pad('% ' + state.tf, c.chg, 'right') +
    ' ' + F.pad('TREND', c.trend);
  lines.push(S.bold(head));
  lines.push(S.dim('─'.repeat(Math.min(width, F.visLen(head)))));
  const slice = rows.slice(offset, offset + maxRows);
  for (const s of slice) {
    const r = getReturn(s, state.tf);
    const paint = r === null ? S.dim : r >= 0 ? S.green : S.red;
    const spark = F.sparkline(s.spark, c.trend);
    const trendPaint = !s.spark || s.spark.length < 2 ? S.dim : s.spark[s.spark.length - 1] >= s.spark[0] ? S.green : S.red;
    lines.push(
      S.bold(F.pad(F.truncate(s.ticker, c.ticker), c.ticker)) + ' ' +
      F.pad(F.truncate(s.name, c.name), c.name) + ' ' +
      S.dim(F.pad(s.exchange, c.exch)) + ' ' +
      F.pad(F.truncate(INDUSTRY_SHORT[s.industry] || s.industry, c.ind), c.ind) + ' ' +
      F.pad(F.fmtPrice(s.price, s.currency), c.price, 'right') + ' ' +
      paint(F.pad(F.fmtPct(r), c.chg, 'right')) + ' ' +
      trendPaint(F.pad(spark || '—', c.trend))
    );
    for (let g = 0; g < rowGap; g++) lines.push(''); // blank row after every stock record
  }
  if (!rows.length) lines.push('No stocks match these filters.');
  return lines;
}

// Used by both the TUI (offset/maxRows) and HTTP (limit). `footer` is an array of lines.
function renderTerminal(result, rows, state, opts = {}) {
  const color = opts.color !== false;
  const width = Math.max(60, opts.width || 80);
  const S = F.makeStyler(color);
  const lines = [...headerLines(result, state, S, width), ''];
  const offset = opts.offset || 0;
  const maxRows = opts.maxRows === undefined ? Math.min(rows.length, state.limit || 25) : opts.maxRows;
  lines.push(...tableLines(rows, state, S, width, offset, maxRows, opts.rowGap === undefined ? 1 : opts.rowGap));
  if (rows.length) {
    const end = Math.min(rows.length, offset + maxRows);
    lines.push(S.dim(`Showing ${offset + 1}-${end} of ${rows.length}`));
  }
  if (opts.footer && opts.footer.length) lines.push('', ...opts.footer);
  return lines.join('\n') + '\n';
}

function curlFooter(host, state, S) {
  const base = `curl ${host}`;
  return [
    S.dim('─'.repeat(60)),
    S.bold('Navigate with curl'),
    `  ${base}/1M`,
    `  ${base}/industry/banking`,
    `  ${base}/exchange/NSE`,
    `  ${base}/search/safaricom`,
    `  curl "${host}/?tf=1Y&exchange=USE&limit=50"`,
    S.dim('Timeframes: 1D 1W 1M 1Y · Industries: banking telecom consumer'),
    S.dim('manufacturing · Exchanges: RSE NSE DSE USE'),
    S.dim('Add /plain (no colour) or /md (markdown); /api/stocks gives JSON.'),
    S.dim('SSH: ssh -p 2222 stocks@ggptrial.ooguy.com  keys: t i e / q'),
  ];
}

function renderMarkdown(result, rows, state, host) {
  const lines = [`# East Africa Stock Screener`, '', `${TF_LABEL[state.tf]} · ${state.industry} · ${state.exchange === 'ALL' ? 'All exchanges' : state.exchange}`, ''];
  notices(result.meta, state.tf).forEach((n) => lines.push(`> ${n}`, ''));
  lines.push('| Ticker | Company | Exch | Industry | Price | % ' + state.tf + ' | Trend |', '|---|---|---|---|---:|---:|---|');
  rows.slice(0, state.limit).forEach((s) => {
    const esc = (v) => String(v).replace(/\|/g, '\\|');
    lines.push(`| ${esc(s.ticker)} | ${esc(s.name)} | ${s.exchange} | ${esc(INDUSTRY_SHORT[s.industry] || s.industry)} | ${F.fmtPrice(s.price, s.currency)} | ${F.fmtPct(getReturn(s, state.tf))} | ${F.sparkline(s.spark) || '-'} |`);
  });
  lines.push('', `Updated ${F.ago(result.meta.generated_at)}. Try: \`curl ${host}/1M\`, \`curl ${host}/industry/banking\`, \`curl ${host}/exchange/NSE\``);
  return lines.join('\n') + '\n';
}

function renderHtml(result, rows, state, host) {
  const E = F.escapeHtml;
  const sel = (name, options, cur) =>
    `<select name="${name}" aria-label="${name}">` +
    options.map(([v, l]) => `<option value="${E(v)}"${v === cur ? ' selected' : ''}>${E(l)}</option>`).join('') + '</select>';
  const body = rows.slice(0, state.limit).map((s) => {
    const r = getReturn(s, state.tf);
    const cls = r === null ? '' : r >= 0 ? 'up' : 'down';
    const sc = !s.spark || s.spark.length < 2 ? '' : s.spark[s.spark.length - 1] >= s.spark[0] ? 'up' : 'down';
    return `<tr><td><b>${E(s.ticker)}</b></td><td>${E(s.name)}</td><td>${E(s.exchange)}</td><td>${E(INDUSTRY_SHORT[s.industry] || s.industry)}</td>` +
      `<td class="n">${E(F.fmtPrice(s.price, s.currency))}</td><td class="n ${cls}">${E(F.fmtPct(r))}</td><td class="${sc} spark">${E(F.sparkline(s.spark) || '—')}</td></tr>`;
  }).join('') || '<tr><td colspan="7">No stocks match these filters.</td></tr>';
  const notes = notices(result.meta, state.tf).map((n) => `<p class="note">${E(n)}</p>`).join('');
  const hostSafe = E(host);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>East Africa Stock Screener</title>
<style>
:root{
--bg:#fafafa;
--fg:#1a1a1a;
--mut:#666;
--line:#ddd;
--up:#0a7d32;
--down:#c62828;
--acc:#d9531e
}
@media (prefers-color-scheme:dark){
:root{
--bg:#121212;
--fg:#eee;
--mut:#999;
--line:#333;
--up:#4cd964;
--down:#ff6b6b;
--acc:#ff8a50
}
}
body{
margin:0;
background:var(--bg);
color:var(--fg);
font:16px/1.5 system-ui,sans-serif
}
main{
max-width:980px;
margin:0 auto;
padding:24px 16px
}
h1{
font-size:1.6rem;
margin:0 0 4px
}
h1 span{
color:var(--acc)
}
.mut{
color:var(--mut)
}
.note{
background:rgba(217,83,30,.12);
padding:8px 12px;
border-radius:6px;
margin:8px 0
}
form{
display:flex;
flex-wrap:wrap;
gap:8px;
margin:16px 0
}
select,input,button{
font:inherit;
padding:8px 10px;
border:1px solid var(--line);
border-radius:6px;
background:var(--bg);
color:var(--fg)
}
button{
background:var(--acc);
color:#111;
border-color:var(--acc);
cursor:pointer;
font-weight:600
}
.wrap{
overflow-x:auto
}
table{
border-collapse:collapse;
width:100%;
min-width:640px
}
th,td{
padding:8px 10px;
border-bottom:1px solid var(--line);
text-align:left;
white-space:nowrap
}
th{
color:var(--mut);
font-size:.8rem;
text-transform:uppercase
}
.n{
text-align:right;
font-variant-numeric:tabular-nums
}
.up{
color:var(--up)
}
.down{
color:var(--down)
}
.spark{
font-family:monospace;
letter-spacing:1px}
pre{background:rgba(127,127,127,.12);
padding:12px;
border-radius:8px;
overflow-x:auto
}
</style>
</head><body><main>
<h1>East Africa <span>Stock Screener</span></h1>
<p class="mut">RSE · NSE · DSE · USE. Fastest growers by % gain. Updated ${E(F.ago(result.meta.generated_at))}.</p>${notes}
<form method="get" action="/">
${sel('tf', TIMEFRAMES.map((t) => [t, TF_LABEL[t]]), state.tf)}
${sel('industry', INDUSTRIES.map((i) => [industrySlug(i), i === 'All' ? 'All industries' : i]), industrySlug(state.industry))}
${sel('exchange', [['ALL', 'All exchanges'], ...EXCHANGE_CODES.map((c) => [c, `${c} · ${EXCHANGES[c].country}`])], state.exchange)}
<input name="q" value="${E(state.q)}" placeholder="Search ticker or name" maxlength="40" aria-label="search">
<button type="submit">Apply</button></form>
<div class="wrap"><table><thead><tr><th>Ticker</th><th>Company</th><th>Exch</th><th>Industry</th><th class="n">Price</th><th class="n">% ${E(state.tf)}</th><th>Trend</th></tr></thead><tbody>${body}</tbody></table></div>
<h2>Use it from a terminal</h2>
<pre>curl ${hostSafe}/1M
curl ${hostSafe}/industry/banking
curl ${hostSafe}/exchange/NSE
curl "${hostSafe}/?format=plain&amp;q=bank"
ssh stocks@&lt;server&gt;</pre>
<p class="mut">Data: <a href="https://mansaapi.com">Mansa API</a>. Not investment advice.</p>
</main></body></html>`;
}

module.exports = { renderTerminal, renderMarkdown, renderHtml, curlFooter, notices };

