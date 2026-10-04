// Re-tunes the motorsport form model (src/predict.mjs MODEL) by backtesting.
// Fetches F1 and MotoGP finishing orders for recent seasons, predicts every race from the 4th of
// each season onward using only earlier races, and ranks settings by the mean log-probability given
// to the actual winner (higher is better; an even 1-in-20 guess scores about -3.0).
// Usage: node scripts/tune-model.mjs [--f1 2024,2025,2026] [--motogp 2025,2026]
import { getJSON, sleep } from '../src/sources/http.mjs';
import { fitPlackettLuce, weightRaces, winChances, MODEL } from '../src/predict.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return (i >= 0 ? process.argv[i + 1] : dflt).split(',').map(Number);
};

async function f1Season(y) {
  const B = 'https://api.jolpi.ca/ergast/f1';
  const all = async (path, key) => {
    const m = new Map();
    for (let off = 0, tot = Infinity; off < tot; off += 100) {
      const d = (await getJSON(`${B}/${path}?format=json&limit=100&offset=${off}`)).MRData;
      tot = Number(d.total);
      for (const r of d.RaceTable.Races) (m.get(r.round)?.[key].push(...r[key])) ?? m.set(r.round, { ...r, [key]: [...r[key]] });
      await sleep(300);
    }
    return m;
  };
  const res = await all(`${y}/results/`, 'Results');
  const spr = await all(`${y}/sprint/`, 'SprintResults');
  const byPos = (a, b) => Number(a.position) - Number(b.position);
  const out = [];
  for (const r of [...res.keys()].map(Number).sort((a, b) => a - b)) {
    const s = spr.get(String(r));
    if (s) out.push({ eventId: `${y}-${r}`, sprint: true, order: s.SprintResults.sort(byPos).map((x) => x.Driver.driverId) });
    out.push({ eventId: `${y}-${r}`, sprint: false, order: res.get(String(r)).Results.sort(byPos).map((x) => x.Driver.driverId) });
  }
  return out;
}

async function motogpSeason(y) {
  const M = 'https://api.motogp.pulselive.com/motogp/v1';
  const season = (await getJSON(`${M}/results/seasons`)).find((s) => s.year === y);
  const cat = (await getJSON(`${M}/results/categories?seasonUuid=${season.id}`)).find((c) => /^MotoGP/.test(c.name)).id;
  const evs = (await getJSON(`${M}/results/events?seasonUuid=${season.id}&isFinished=true`)).filter((e) => !e.test).sort((a, b) => a.date_start.localeCompare(b.date_start));
  const out = [];
  for (const ev of evs) {
    const sess = await getJSON(`${M}/results/sessions?eventUuid=${ev.id}&categoryUuid=${cat}`);
    for (const [t, sprint] of [['SPR', true], ['RAC', false]]) {
      const x = sess.find((s) => s.type === t);
      if (!x) continue;
      await sleep(150);
      const c = await getJSON(`${M}/results/session/${x.id}/classification?test=false`);
      if (c.classification?.length) out.push({ eventId: ev.id, sprint, order: c.classification.map((r) => r.rider.full_name) });
    }
  }
  return out;
}

function score(seasons, { recency, topK, prior }) {
  let ll = 0, n = 0, hits = 0, fav = 0;
  for (const res of seasons) {
    const mains = res.map((r, i) => (!r.sprint ? i : -1)).filter((i) => i >= 0);
    mains.forEach((idx, m) => {
      if (m < 3) return;
      let cut = idx;
      while (cut > 0 && res[cut - 1].eventId === res[idx].eventId) cut--;
      const ch = winChances(fitPlackettLuce(weightRaces(res.slice(0, cut), { recency }), { topK, prior, iters: 200 }), res[idx].order);
      const winner = res[idx].order[0];
      ll += Math.log(Math.max(ch.find((c) => c.key === winner).pct / 100, 1e-4));
      n++;
      if (ch[0].key === winner) hits++;
      fav += ch[0].pct;
    });
  }
  return { ll: ll / n, n, hits, fav: fav / n };
}

const seasons = [];
for (const y of arg('--f1', '2024,2025,2026')) seasons.push(await f1Season(y));
for (const y of arg('--motogp', '2025,2026')) seasons.push(await motogpSeason(y));
const grid = [];
for (const recency of [0.7, 0.8, 0.85, 0.9, 0.95]) for (const topK of [1, 3, 5, 10]) for (const prior of [0.05, 0.1, 0.25, 0.5]) grid.push({ recency, topK, prior });
const rows = grid.map((g) => ({ g, ...score(seasons, g) })).sort((a, b) => b.ll - a.ll);
const cur = score(seasons, MODEL);
console.log(`current ${JSON.stringify(MODEL)}: log-prob ${cur.ll.toFixed(3)}, favourite won ${cur.hits}/${cur.n}, rated ${cur.fav.toFixed(1)}% on average`);
for (const r of rows.slice(0, 8)) console.log(`${JSON.stringify(r.g)}: log-prob ${r.ll.toFixed(3)}, favourite won ${r.hits}/${r.n}, rated ${r.fav.toFixed(1)}% on average`);
