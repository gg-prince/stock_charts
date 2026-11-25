'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const EXCHANGES = {
  RSE: { name: 'Rwanda Securities Exchange', country: 'Rwanda', currency: 'RWF' },
  NSE: { name: 'Nairobi Securities Exchange', country: 'Kenya', currency: 'KES' },
  DSE: { name: 'Dar es Salaam Stock Exchange', country: 'Tanzania', currency: 'TZS' },
  USE: { name: 'Uganda Securities Exchange', country: 'Uganda', currency: 'UGX' },
};
const EXCHANGE_CODES = Object.keys(EXCHANGES);
const TIMEFRAMES = ['1D', '1W', '1M', '1Y'];
const INDUSTRIES = ['All', 'Banking & Finance', 'Telecom', 'Consumer & Breweries', 'Manufacturing & Energy'];
const INDUSTRY_SHORT = {
  'Banking & Finance': 'Banking',
  Telecom: 'Telecom',
  'Consumer & Breweries': 'Consumer',
  'Manufacturing & Energy': 'Mfg/Energy',
  Other: 'Other',
};

function classifyIndustry(sector) {
  const s = String(sector || '').toLowerCase();
  if (/bank|financ|insur|invest|microfin|mortgage|asset manag|securit/.test(s)) return 'Banking & Finance';
  if (/telecom|communic|mobile|network/.test(s)) return 'Telecom';
  if (/consumer|beverage|brewer|food|agri|retail|tobacco|sugar|tea|coffee|farm|media/.test(s)) return 'Consumer & Breweries';
  if (/manufactur|industr|energy|oil|petrol|gas|cement|construct|power|utilit|mining|real estate|commercial/.test(s)) return 'Manufacturing & Energy';
  return 'Other';
}

// Cache location: EA_CACHE env, else /var/cache (production), else ./data.
function writable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}
function cachePath(forWrite = false) {
  if (process.env.EA_CACHE) return process.env.EA_CACHE;
  const prod = '/var/cache/ea-stocks.json';
  const dev = path.join(ROOT, 'data', 'ea-stocks.json');
  if (forWrite) return writable('/var/cache') ? prod : dev;
  return fs.existsSync(prod) ? prod : dev;
}
function historyPath() {
  return cachePath(true).replace(/\.json$/, '') + '-history.json';
}

module.exports = {
  ROOT, EXCHANGES, EXCHANGE_CODES, TIMEFRAMES, INDUSTRIES, INDUSTRY_SHORT,
  classifyIndustry, cachePath, historyPath,
};
