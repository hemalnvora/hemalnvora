// Schema checks for board documents, shared by scripts/validate.mjs and the board kit.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['scheduled', 'done', 'cancelled', 'provisional']);
const SPORTS = new Set(['motorsport', 'cricket', 'worldcup']);

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
  }
  if (s.standings && !Array.isArray(s.standings.rows)) errs.push('standings.rows must be an array');
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


// Returns a list of problems for any board document: a whole board, one series, or the headlines.
export function checkDocument(doc) {
  if (Array.isArray(doc.series)) {
    const errs = doc.series.flatMap((s) => checkSeries(s).map((e) => `${s.id}: ${e}`));
    if (doc.buzz) errs.push(...checkBuzz(doc.buzz).map((e) => `buzz: ${e}`));
    return errs;
  }
  return 'items' in doc && !('events' in doc) ? checkBuzz(doc) : checkSeries(doc);
}
