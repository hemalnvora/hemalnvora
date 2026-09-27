// Checks series documents before they are written to the board. Exits 1 on any problem.
// Usage: node scripts/validate.mjs <file-or-dir> [...]
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['scheduled', 'done', 'cancelled', 'provisional']);
const SPORTS = new Set(['motorsport', 'cricket', 'worldcup']);

async function files(p) {
  if ((await stat(p)).isDirectory()) return (await readdir(p)).filter((f) => f.endsWith('.json')).map((f) => path.join(p, f));
  return [p];
}

function checkSeries(s) {
  const errs = [];
  for (const k of ['id', 'name', 'code', 'sport']) if (typeof s[k] !== 'string' || !s[k]) errs.push(`missing ${k}`);
  if (s.sport && !SPORTS.has(s.sport)) errs.push(`bad sport "${s.sport}"`);
  if (typeof s.order !== 'number') errs.push('missing numeric order');
  if (!Array.isArray(s.events) || !s.events.length) errs.push('events must be a non-empty array');
  const ids = new Set();
  for (const e of s.events || []) {
    const where = `event ${e.id || '(no id)'}`;
    if (!e.id) errs.push(`${where}: missing id`);
    else if (ids.has(e.id)) errs.push(`${where}: duplicate id`);
    ids.add(e.id);
    if (!e.title) errs.push(`${where}: missing title`);
    if (!DATE.test(e.start || '')) errs.push(`${where}: start must be YYYY-MM-DD`);
    if (e.end !== null && e.end !== undefined && !DATE.test(e.end)) errs.push(`${where}: end must be YYYY-MM-DD or null`);
    if (e.end && e.start && e.end < e.start) errs.push(`${where}: end before start`);
    if (!STATUSES.has(e.status)) errs.push(`${where}: status must be one of ${[...STATUSES].join(', ')}`);
    if (e.time && Number.isNaN(Date.parse(e.time))) errs.push(`${where}: time is not a valid ISO timestamp`);
  }
  if (s.standings && !Array.isArray(s.standings.rows)) errs.push('standings.rows must be an array');
  return errs;
}

function checkBuzz(b) {
  const errs = [];
  if (!Array.isArray(b.items) || !b.items.length) errs.push('items must be a non-empty array');
  for (const [i, x] of (b.items || []).entries()) {
    for (const k of ['series', 'title', 'summary', 'date']) if (!x[k]) errs.push(`item ${i}: missing ${k}`);
    if (x.date && !DATE.test(x.date)) errs.push(`item ${i}: date must be YYYY-MM-DD`);
  }
  return errs;
}

let bad = 0;
for (const arg of process.argv.slice(2)) {
  for (const f of await files(arg)) {
    let doc;
    try {
      doc = JSON.parse(await readFile(f, 'utf8'));
    } catch (err) {
      console.log(`✗ ${f}: invalid JSON (${err.message})`);
      bad++;
      continue;
    }
    let errs;
    if (Array.isArray(doc.series)) {
      // A whole board (data/latest.json): every series plus the headlines.
      errs = doc.series.flatMap((s) => checkSeries(s).map((e) => `${s.id}: ${e}`));
      if (doc.buzz) errs.push(...checkBuzz(doc.buzz).map((e) => `buzz: ${e}`));
    } else {
      errs = 'items' in doc && !('events' in doc) ? checkBuzz(doc) : checkSeries(doc);
    }
    if (errs.length) {
      bad++;
      console.log(`✗ ${f}\n  - ${errs.join('\n  - ')}`);
    } else {
      console.log(`✓ ${f}`);
    }
  }
}
process.exit(bad ? 1 : 0);
