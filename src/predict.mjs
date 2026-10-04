// Win-probability models for the board.
//
// Motorsport (F1, MotoGP): a Plackett–Luce model fitted to this season's finishing orders.
// Each driver gets a strength θ; the chance of winning a race is θ / Σθ over the field.
// Recent races count more (each race back is worth MODEL.recency times the one after it) and
// sprints count half. Title chances come from simulating the rest of the season many times
// with the same strengths and the real points tables.
//
// Cricket: ICC team ratings. The ICC system pays a winner its opponent's rating + 50 and a loser
// the opponent's rating − 50, so a team holds its rating when it wins 0.5 + d/100 of matches
// against a side rated d points lower; past a 40-point gap it pays +10/−90, i.e. a 90% ceiling.
// We use that rule directly, add a home edge, and keep a fixed share for the draw in Tests.

// Chosen by backtesting (scripts/tune-model.mjs) on F1 2024–26 and MotoGP 2025–26, predicting each
// race from earlier races only: across 87 races the favourite was rated 33% on average and won 30%
// of the time, and the winner's mean log-probability was −1.90 (an even 1-in-20 guess scores −3.00).
export const MODEL = {
  recency: 0.85, // weight of a race relative to the one after it
  topK: 3, // only the fight for the podium informs strengths
  prior: 0.1, // Gamma prior pseudo-count; keeps one-off results from dominating
};

const round1 = (x) => Math.round(x * 10) / 10;

/** "31%", "<1%", ">99%": simulations never prove certainty, so the ends are shown as bounds. */
export const formatPct = (x) => (x >= 99.5 ? '>99%' : x < 1 ? '<1%' : `${Math.round(x)}%`);

/**
 * races: [{ order: [key, ...] (finishing order, all classified + retirements last), weight }]
 * returns Map key -> strength (mean 1)
 */
export function fitPlackettLuce(races, { iters = 300, topK = MODEL.topK, prior = MODEL.prior } = {}) {
  const keys = [...new Set(races.flatMap((r) => r.order))];
  const theta = new Map(keys.map((k) => [k, 1]));
  for (let it = 0; it < iters; it++) {
    const wins = new Map(keys.map((k) => [k, 0]));
    const denom = new Map(keys.map((k) => [k, 0]));
    for (const { order, weight } of races) {
      const n = order.length;
      const stages = Math.min(topK, n - 1);
      // remaining-set sums: S_j = Σ θ over order[j..n-1]
      const suffix = new Array(n + 1).fill(0);
      for (let j = n - 1; j >= 0; j--) suffix[j] = suffix[j + 1] + theta.get(order[j]);
      let acc = 0; // Σ_{j<=i, j<stages} 1/S_j
      for (let i = 0; i < n; i++) {
        if (i < stages) {
          acc += 1 / suffix[i];
          wins.set(order[i], wins.get(order[i]) + weight);
        }
        denom.set(order[i], denom.get(order[i]) + weight * acc);
      }
    }
    let delta = 0;
    for (const k of keys) {
      const next = (wins.get(k) + prior) / (denom.get(k) + prior);
      delta = Math.max(delta, Math.abs(next - theta.get(k)));
      theta.set(k, next);
    }
    if (delta < 1e-9) break;
  }
  return theta;
}

/** Weighted list of races for the fit: most recent race weight 1, then recency^age; sprints half. */
export function weightRaces(results, { recency = MODEL.recency } = {}) {
  // results: [{ order, sprint: bool }] in chronological order
  const mains = results.filter((r) => !r.sprint).length;
  let seen = 0;
  const out = [];
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    const age = r.sprint ? Math.max(0, seen - 1) : seen;
    out.push({ order: r.order, weight: Math.pow(recency, age) * (r.sprint ? 0.5 : 1) });
    if (!r.sprint) seen++;
  }
  return mains ? out.reverse() : [];
}

/** Win chances for a field: [{ key, pct }] sorted, with pct in 0–100. */
export function winChances(theta, field) {
  const vals = field.map((k) => ({ key: k, t: theta.get(k) ?? MODEL.prior / (MODEL.prior + 1) }));
  const sum = vals.reduce((s, v) => s + v.t, 0);
  return vals.map((v) => ({ key: v.key, pct: (100 * v.t) / sum })).sort((a, b) => b.pct - a.pct);
}

/** Compact prediction object for an event. */
export function predictionFrom(chances, names, { label, asOf, top = 5, teams = new Map() }) {
  const picks = chances.slice(0, top).map((c) => ({ name: names.get(c.key) || c.key, ...(teams.get(c.key) ? { team: teams.get(c.key) } : {}), pct: round1(c.pct) }));
  const other = round1(Math.max(0, 100 - picks.reduce((s, p) => s + p.pct, 0)));
  return { method: 'form', label, asOf, picks, ...(other > 0.05 ? { other } : {}) };
}

// Gumbel-max sampling of a Plackett–Luce ordering.
function sampleOrder(field, logTheta, rand) {
  return field
    .map((k) => ({ k, s: logTheta.get(k) - Math.log(-Math.log(rand() || 1e-12)) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.k);
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Title chances by simulation.
 * points: Map key -> current points; remaining: [{ sprint: bool }]; tables: { race: [...], sprint: [...] }
 */
export function titleChances(theta, points, remaining, tables, { sims = 20000, seed = 7 } = {}) {
  const field = [...points.keys()];
  const logTheta = new Map(field.map((k) => [k, Math.log(theta.get(k) ?? MODEL.prior / (MODEL.prior + 1))]));
  const titles = new Map(field.map((k) => [k, 0]));
  const rand = mulberry32(seed);
  for (let s = 0; s < sims; s++) {
    const pts = new Map(points);
    for (const ev of remaining) {
      const award = (table) => sampleOrder(field, logTheta, rand).forEach((k, i) => { if (i < table.length) pts.set(k, pts.get(k) + table[i]); });
      if (ev.sprint && tables.sprint) award(tables.sprint);
      award(tables.race);
    }
    let best = -1;
    let champ = [];
    for (const [k, p] of pts) {
      if (p > best) { best = p; champ = [k]; } else if (p === best) champ.push(k);
    }
    for (const k of champ) titles.set(k, titles.get(k) + 1 / champ.length);
  }
  return new Map([...titles].map(([k, v]) => [k, round1((100 * v) / sims)]));
}

export const POINTS = {
  f1: { race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], sprint: [8, 7, 6, 5, 4, 3, 2, 1] },
  motogp: { race: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], sprint: [12, 9, 7, 6, 5, 4, 3, 2, 1] },
};

/**
 * Builds pre-race predictions for every race of the season (backtested for finished ones, using
 * only the races before it) and for the remaining races. Mutates events in place.
 *   results: chronological [{ eventId, order: [key], sprint }]
 *   names/teams: Map key -> display name / team
 */
export function applyMotorsportModel({ events, results, names, teams, label, minRaces = 3 }) {
  const asOf = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const mainIdx = results.map((r, i) => (!r.sprint ? i : -1)).filter((i) => i >= 0);
  // Finished races: fit on everything that happened before that race's weekend.
  mainIdx.forEach((idx, n) => {
    if (n < minRaces) return;
    const r = results[idx];
    const ev = events.find((e) => e.id === r.eventId);
    if (!ev || ev.prediction) return; // a prediction frozen before the race wins
    let cut = idx;
    while (cut > 0 && results[cut - 1].eventId === r.eventId) cut--; // drop this weekend's sprint
    const theta = fitPlackettLuce(weightRaces(results.slice(0, cut)));
    ev.prediction = { ...predictionFrom(winChances(theta, r.order), names, { label, asOf, teams }), backtest: true };
  });
  if (mainIdx.length < minRaces) return null;
  const theta = fitPlackettLuce(weightRaces(results));
  const lastField = results[mainIdx[mainIdx.length - 1]].order;
  for (const ev of events) {
    if (ev.status !== 'scheduled' || ev.prediction?.frozen) continue;
    ev.prediction = predictionFrom(winChances(theta, lastField), names, { label, asOf, teams });
  }
  return theta;
}

// ---------- cricket ----------
const HOME_EDGE = { Test: 15, ODI: 10, T20I: 7 };
const TEST_DRAW = 15; // percent

export function cricketPrediction(event, ratings, { asOf } = {}) {
  if (!event || event.status !== 'scheduled' || !Array.isArray(event.teams) || event.teams.length !== 2 || !event.format) return null;
  const table = ratings?.[event.gender === 'women' ? 'women' : 'men']?.[event.format];
  if (!table) return null;
  const [a, b] = event.teams;
  if (typeof table[a] !== 'number' || typeof table[b] !== 'number') return null;
  const edge = HOME_EDGE[event.format] ?? 10;
  const diff = table[a] - table[b] + (event.home === a ? edge : event.home === b ? -edge : 0);
  const pA = Math.min(0.9, Math.max(0.1, 0.5 + diff / 100));
  const draw = event.format === 'Test' ? TEST_DRAW : 0;
  const scale = (100 - draw) / 100;
  const picks = [
    { name: a, pct: round1(100 * pA * scale) },
    { name: b, pct: round1(100 * (1 - pA) * scale) },
  ].sort((x, y) => y.pct - x.pct);
  if (draw) picks.push({ name: 'Draw', pct: draw });
  return {
    method: 'ratings',
    label: `ICC ${event.gender === 'women' ? "women's " : ''}${event.format} ratings (${a} ${table[a]}, ${b} ${table[b]})${event.home ? `, home edge to ${event.home}` : ', neutral venue'}`,
    asOf: asOf || ratings.asOf,
    picks,
  };
}

/** Fills `prediction` on scheduled cricket matches that have teams + format, from the ratings table. */
export function applyCricketRatings(series, ratings, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!ratings) return 0;
  let n = 0;
  for (const ev of series.events) {
    if (ev.status !== 'scheduled' || ev.start < today) continue; // never price a match that has started
    if (ev.prediction && ev.prediction.method !== 'ratings') continue; // keep odds-based ones
    const p = cricketPrediction(ev, ratings);
    if (p) { ev.prediction = p; n++; }
  }
  return n;
}

/** Keeps the last pre-event prediction on events that have since finished. */
export function carryPredictions(nextSeries, prevSeries) {
  if (!prevSeries) return;
  const prev = new Map(prevSeries.events.map((e) => [e.id, e]));
  for (const ev of nextSeries.events) {
    const p = prev.get(ev.id)?.prediction;
    if (!p) continue;
    if (ev.status === 'done' && (!ev.prediction || ev.prediction.backtest) && !p.backtest) {
      ev.prediction = { ...p, frozen: true };
    }
  }
}
