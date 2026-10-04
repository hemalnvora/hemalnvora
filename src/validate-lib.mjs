// Schema checks for board documents, shared by scripts/validate.mjs and the board kit.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['scheduled', 'done', 'cancelled', 'provisional']);
const SPORTS = new Set(['motorsport', 'cricket', 'worldcup']);
const FORMATS = new Set(['Test', 'ODI', 'T20I']);
const METHODS = new Set(['form', 'ratings', 'odds']);
const isStr = (x) => typeof x === 'string' && x.length > 0;

// Optional result and prediction fields on an event.
function checkExtras(e, where) {
  const errs = [];
  if (e.prediction !== undefined) {
    const p = e.prediction;
    if (!p || typeof p !== 'object') errs.push(`${where}: prediction must be an object`);
    else {
      if (!METHODS.has(p.method)) errs.push(`${where}: prediction.method must be one of ${[...METHODS].join(', ')}`);
      if (!isStr(p.label)) errs.push(`${where}: prediction.label is required (say how the numbers were made)`);
      if (!Array.isArray(p.picks) || !p.picks.length) errs.push(`${where}: prediction.picks must be a non-empty array`);
      else {
        for (const x of p.picks) if (!isStr(x.name) || typeof x.pct !== 'number' || x.pct < 0 || x.pct > 100) errs.push(`${where}: each pick needs a name and a pct between 0 and 100`);
        const sum = p.picks.reduce((a, x) => a + (x.pct || 0), 0) + (p.other || 0);
        if (sum > 100.6) errs.push(`${where}: prediction percentages add up to ${sum.toFixed(1)}, over 100`);
      }
      if (p.method === 'odds' && !p.source?.url) errs.push(`${where}: odds-based predictions need source.url`);
    }
  }
  if (e.podium !== undefined && (!Array.isArray(e.podium) || e.podium.some((x) => !isStr(x.name) || typeof x.pos !== 'number'))) errs.push(`${where}: podium must be [{pos, name, team?, detail?}]`);
  if (e.scores !== undefined && (!Array.isArray(e.scores) || e.scores.some((x) => !isStr(x.team) || !isStr(x.score)))) errs.push(`${where}: scores must be [{team, score}]`);
  if (e.highlights !== undefined && (!Array.isArray(e.highlights) || e.highlights.some((x) => !isStr(x)))) errs.push(`${where}: highlights must be an array of strings`);
  if (e.winner !== undefined && !isStr(e.winner)) errs.push(`${where}: winner must be a non-empty string`);
  if (e.teams !== undefined && (!Array.isArray(e.teams) || e.teams.length !== 2 || !e.teams.every(isStr))) errs.push(`${where}: teams must be two team names`);
  if (e.format !== undefined && !FORMATS.has(e.format)) errs.push(`${where}: format must be one of ${[...FORMATS].join(', ')}`);
  if (e.status !== 'done' && (e.podium || e.scores || e.winner)) errs.push(`${where}: results (podium/scores/winner) only belong on done events`);
  return errs;
}

export function checkSeries(s) {
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
    errs.push(...checkExtras(e, where));
  }
  if (s.standings && !Array.isArray(s.standings.rows)) errs.push('standings.rows must be an array');
  for (const r of s.standings?.rows || []) if (r.titlePct !== undefined && (typeof r.titlePct !== 'number' || r.titlePct < 0 || r.titlePct > 100)) errs.push(`standings: titlePct for ${r.name} must be 0–100`);
  return errs;
}

export function checkBuzz(b) {
  const errs = [];
  if (!Array.isArray(b.items) || !b.items.length) errs.push('items must be a non-empty array');
  for (const [i, x] of (b.items || []).entries()) {
    for (const k of ['series', 'title', 'summary', 'date']) if (!x[k]) errs.push(`item ${i}: missing ${k}`);
    if (x.date && !DATE.test(x.date)) errs.push(`item ${i}: date must be YYYY-MM-DD`);
  }
  return errs;
}

export function checkRatings(r) {
  const errs = [];
  if (!DATE.test(String(r.asOf || '').slice(0, 10))) errs.push('asOf must be a date');
  for (const g of ['men', 'women']) {
    for (const [fmt, table] of Object.entries(r[g] || {})) {
      if (!FORMATS.has(fmt)) errs.push(`${g}.${fmt}: unknown format`);
      for (const [team, v] of Object.entries(table)) if (typeof v !== 'number') errs.push(`${g}.${fmt}.${team}: rating must be a number`);
    }
  }
  if (!r.men) errs.push('men ratings missing');
  return errs;
}

// Returns a list of problems for any board document: a whole board, one series, or the headlines.
export function checkDocument(doc) {
  if (Array.isArray(doc.series)) {
    const errs = doc.series.flatMap((s) => checkSeries(s).map((e) => `${s.id}: ${e}`));
    if (doc.buzz) errs.push(...checkBuzz(doc.buzz).map((e) => `buzz: ${e}`));
    return errs;
  }
  if (doc.men || doc.women) return checkRatings(doc);
  return 'items' in doc && !('events' in doc) ? checkBuzz(doc) : checkSeries(doc);
}
