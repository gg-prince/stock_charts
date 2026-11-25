'use strict';
// Handling missing dotenv library.
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const candidates = [file, path.join(__dirname, '..', '.env'), '/etc/ea-stocks.env'].filter(Boolean);
  for (const f of candidates) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
module.exports = { loadEnv };
