## East Africa Stock Dashboard

# Access now in terminal: **ssh -p 2222 stocks@ggptrial.ooguy.com** . **password: betty**
# Demo: **https://youtu.be/uFhvNZi8gi8**

A zero-dependency Node.js app that ranks the fastest-growing stocks on the **Rwanda (RSE), Nairobi (NSE), Dar es Salaam (DSE) and Uganda (USE)** exchanges. One data pipeline, three ways to use it:

| Where | How | What you get |
|---|---|---|
| Browser | `http://<host>/` | Normal web page with filters |
| Terminal over HTTP | `curl http://<host>/` | Coloured table rendered in the terminal (like wttr.in) |
| Terminal over SSH | `ssh stocks@<host>` | Interactive keyboard-driven screener |

**Why it is useful:** East African markets are poorly covered by global finance sites. Students, young investors and analysts can open one screen and see which listed companies are moving, in local currency, filtered by industry and exchange, without installing anything.

> Not investment advice. Prices come from a third-party API and may be delayed or incomplete.

```
EAST AFRICA STOCK SCREENER  RSE · NSE · DSE · USE
Fastest growers by % gain · 1 Week · All industries · All exchanges
Data: demo dataset · updated 7 min ago

TICKER   COMPANY                  EXCH INDUSTRY           PRICE     % 1W TREND
────────────────────────────────────────────────────────────────────────────────
NNA4     Nairobi Demo Industries  NSE  Mfg/Energy     KES 13.12   +3.05% ▁▁▃▄▅█▆
RKI1     Kigali Demo Bank         RSE  Banking       RWF 118.41   +2.30% ▂▂▁▄▃▅█
DDA4     Dar Demo Industries      DSE  Mfg/Energy    TZS 10,212   +1.81% ▁▂▅▇▄▄█
```
*(Sample uses the built-in fictional demo dataset. Real runs show real companies.)*

## Features

- **Fastest growers first**, sorted by % gain over 1D, 1W (default), 1M or 1Y.
- **Filters and search:** industry (Banking & Finance, Telecom, Consumer & Breweries, Manufacturing & Energy), exchange, and ticker/company search.
- **Trend sparklines** (`▁▂▃▄▅▆▇█`, green when up, red when down) and prices in RWF, KES, TZS, UGX.
- **Curl-aware web server:** detects `curl`, `Wget`, `HTTPie`, `PowerShell`, `fetch` and returns `text/plain; charset=utf-8` with ANSI colour. Browsers get HTML.
- **Forced formats** from any client: `?format=ansi|plain|md|html|json` or path suffixes `/plain`, `/md`, `/ansi`. `Accept: text/plain`, `?nocolor=1`, and a `NO-COLOR` / `X-No-Color` header give uncoloured output.
- **Fast and cheap:** users only read a local cache file. A cron job refreshes it, so visitors never use your API quota.
- **Bonus work:** response caching layer (pre-computed cache file), strict input validation and HTML escaping (XSS-safe), per-IP rate limiting, security headers, restricted SSH user, data visualisation (sparklines), automated tests.

## How it works

```
cron (2x weekday) ──> fetch-data.js ──> Mansa API (4 requests per run)
                           │
                           ├─ appends today's close to  ea-stocks-history.json
                           └─ writes returns + sparklines to  ea-stocks.json (atomic)
                                           │
              ┌────────────────────────────┴───────────────────────────┐
         server.js (HTTP :3000)                                  index.js (SSH TUI)
   HTML / ANSI / plain / md / JSON                         t i e / ↑↓ q keys, reads cache only
              ▲
   Lb01 (HAProxy, round robin) ◄── users;  Web01 and Web02 each run server.js
```

Files: `fetch-data.js` (API fetcher, return calculator, cache writer) · `server.js` (HTTP + content negotiation) · `index.js` (SSH terminal UI) · `lib/` (config, data, formatting, rendering) · `deploy/` (systemd, cron, sshd, HAProxy/nginx, scripts) · `test/`.

## API used and credit

- **[Mansa API](https://mansaapi.com)** by Mansa Labs for African stock market data. Docs: <https://mansaapi.com/docs>. Student program (free Starter key): <https://mansaapi.com/students>.
- Endpoints used: `GET /api/v1/markets/exchanges/{exchange}/stocks` (current quotes, one request per exchange). Optional with a Pro key: `GET .../stocks/{ticker}/history`.
- Auth: `Authorization: Bearer <key>`. The key is read from the environment, never hard-coded or committed.
- Free tier limit is 100 requests/day. This app uses **8/day** (2 runs × 4 exchanges) and has a built-in daily budget guard (`MAX_REQUESTS_PER_DAY`, default 90).

### Important data limitations (read this)

1. **Per-stock price history is a Pro feature** in Mansa's docs, so the free tier cannot give 1W/1M/1Y returns directly. The fetcher therefore **records one close per ticker per day** and computes returns from its own history. `1D` works immediately (from the API's daily change); **`1W` needs about a week of cron runs, `1M` about a month, `1Y` about a year.** Until then those cells show `—` and the screen says "Building history". With a Pro key, set `MANSA_HISTORY_BACKFILL=1` to backfill instead.
2. **Exchange coverage:** the docs list NSE and DSE; I could not confirm RSE or USE codes. If the API has no data for an exchange, it is skipped and the screen says `No data from the API for: RSE`. If the API uses different codes, set `MANSA_CODE_RSE` / `MANSA_CODE_USE`.
3. Response field names are read tolerantly (`ticker`/`symbol`, `price`/`close`/`last_price`, `change_pct`...) because the live schema was inferred from the docs. Run `node fetch-data.js` once with your key and check the output.

## Run locally

Requires **Node.js 18+**. No `npm install` needed (zero dependencies).

```bash
git clone <your-repo-url> && cd ea-stocks

# Try it instantly with fictional demo data (no key needed)
npm run demo            # writes data/ea-stocks.json
npm start               # HTTP on http://localhost:3000
node index.js           # interactive terminal UI

# Use real data
cp .env.example .env    # then put your key in .env (git-ignored)
npm run fetch           # calls the API once and writes the cache
```

Try the terminal side from a second shell:

```bash
curl localhost:3000                      # coloured table
curl localhost:3000/1M                   # 1-month timeframe
curl localhost:3000/industry/banking
curl localhost:3000/exchange/NSE
curl localhost:3000/search/bank
curl "localhost:3000/?tf=1Y&exchange=USE&limit=50"
curl localhost:3000/plain                # no colour
curl localhost:3000/md                   # markdown
curl localhost:3000/api/stocks           # JSON
```

Every terminal view ends with a footer of example `curl` commands for the other routes.

### SSH screen keys

| Key | Action |
|---|---|
| `t` | Cycle timeframe 1D → **1W** → 1M → 1Y |
| `i` | Cycle industry (All, Banking & Finance, Telecom, Consumer & Breweries, Manufacturing & Energy) |
| `e` | Cycle exchange (All, RSE, NSE, DSE, USE) |
| `/` | Search by ticker or company, `Enter` apply, `Esc` cancel |
| `↑ ↓ PgUp PgDn` | Scroll |
| `q` | Quit and close the session |

Sessions close after 15 idle minutes. If there is no TTY, the app prints a single plain snapshot and exits.

### Errors you will see (handled gracefully)

| Situation | Result |
|---|---|
| No cache yet | HTTP `503` + "Data not available yet"; SSH shows a friendly message |
| API down / key rejected / rate limited | Fetcher logs it, **keeps the previous cache**, exits non-zero |
| One exchange missing or empty | Others still shown; a notice names the missing one |
| Corrupt cache file | Treated as unavailable, no crash |
| Bad query values | Whitelisted to safe defaults; unknown routes return `404` with help; non-GET returns `405` |


## Security and credentials

- API keys live only in `.env` (local) or `/etc/ea-stocks.env` (servers). Both are git-ignored or outside the repo. `.env.example` has placeholders only.
- Query parameters are whitelisted; all HTML output is escaped; responses send CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`; per-IP limit of 120 requests/minute.
- The web process never sees the API key and the SSH user can only run the screener.
- **Credentials for the grader** (provide in the submission comment, not in this repo): Mansa API key · SSH login `stocks` / password · load balancer address.

## Tests

```bash
npm test
```

9 automated tests cover user-agent detection, format overrides, routing, industry classification, input sanitising, sorting, formatting helpers, and the fetcher against a **mock Mansa API** (return calculations, missing exchanges, one request per exchange, keeping the old cache when the key is rejected).

## Challenges and how I handled them

- **No free per-stock history:** build my own daily history and show `—` plus a notice until enough days exist, rather than faking returns.
- **Request budget:** four exchanges at a 2–4 hour cron would use 24–48 requests a day, so the schedule is twice per weekday (8/day), with a hard daily budget guard.
- **Readers seeing half-written files:** the cache is written to a temp file and renamed (atomic).
- **Terminal UI glitches:** raw-mode output needs `\r\n`; the alternate screen is always restored on quit, signals, or crashes.
- **Two products in one spec:** the HTTP renderer and SSH screen share the same data and renderer modules, so they cannot drift apart.

## Credits

[Mansa API](https://mansaapi.com) for market data · terminal-first design inspired by [wttr.in](https://github.com/chubin/wttr.in) · Unicode block characters for sparklines · built with Node.js built-ins only (`http`, `fs`, `readline`, `fetch`, `node:test`).
