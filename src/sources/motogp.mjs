// MotoGP via the public API behind motogp.com (api.motogp.pulselive.com). No key needed.
import { getJSON, sleep, toUtcIso, titleCase } from './http.mjs';
import { applyMotorsportModel, carryPredictions, titleChances, formatPct, POINTS } from '../predict.mjs';

const BASE = 'https://api.motogp.pulselive.com/motogp/v1';

const SESSIONS = { Q2: 'Qualifying', SPR: 'Sprint', RAC: 'Race' };

function resultDetails(r) {
  const rows = r?.race?.classification;
  if (!rows?.length) return {};
  const podium = rows.slice(0, 3).map((x) => ({
    pos: x.position,
    name: x.rider.full_name,
    team: x.team?.name || x.constructor?.name || '',
    detail: x.position === 1 ? x.time : `+${x.gap?.first}s`,
  }));
  const highlights = [];
  const rec = (type) => (r.race.records || []).find((x) => x.type === type && !x.year);
  const pole = rec('poleLap');
  if (pole) highlights.push(`Pole: ${pole.rider.full_name} (${pole.bestLap?.time})`);
  const fl = rec('fastestLap');
  if (fl) highlights.push(`Fastest lap: ${fl.rider.full_name} (${fl.bestLap?.time})`);
  const sp = r.sprint?.classification?.[0];
  if (sp) highlights.push(`Sprint won by ${sp.rider.full_name}`);
  const out = rows.filter((x) => x.status !== 'INSTND').length;
  if (out) highlights.push(`${out} non-finisher${out === 1 ? '' : 's'}`);
  const maker = rows[0].constructor?.name;
  return { podium, winner: podium[0].name, highlights, result: `Winner: ${podium[0].name}${maker ? ` (${maker})` : ''}` };
}

function mapEvent(e, year, seq, results) {
  const sessions = (e.broadcasts || [])
    .filter((b) => b.category?.acronym === 'MGP' && b.type === 'SESSION' && SESSIONS[b.shortname])
    .map((b) => ({ name: SESSIONS[b.shortname], time: toUtcIso(b.date_start) }))
    .filter((s) => s.time)
    .sort((a, b) => a.time.localeCompare(b.time));
  const race = sessions.find((s) => s.name === 'Race');
  const start = e.date_start.slice(0, 10);
  const status = e.status === 'FINISHED' ? 'done' : /CANCEL/i.test(e.status || '') ? 'cancelled' : 'scheduled';
  const circuit = e.circuit || {};
  return {
    id: `mgp-${year}-${String(seq).padStart(2, '0')}`,
    round: seq,
    title: titleCase(e.name.replace(/^.*?(GRAND PRIX)/i, '$1').replace(/\s+/g, ' ')),
    place: [circuit.name, circuit.country].filter(Boolean).join(', '),
    start,
    end: e.date_end.slice(0, 10),
    ...(race ? { time: race.time, timeLabel: 'Race' } : {}),
    ...(sessions.length ? { sessions } : {}),
    status,
    ...resultDetails(results.get(start)),
    // The API's `url` field is a slug ("Thailand") and `urls` are hospitality offers, so link the calendar.
    link: 'https://www.motogp.com/en/calendar',
  };
}

// Race and sprint classifications of every finished round, keyed by the round's first day.
async function resultsFor(seasonUuid, categoryUuid) {
  const out = new Map();
  const finished = await getJSON(`${BASE}/results/events?seasonUuid=${seasonUuid}&isFinished=true`);
  for (const ev of finished.filter((x) => !x.test)) {
    try {
      await sleep(250);
      const sessions = await getJSON(`${BASE}/results/sessions?eventUuid=${ev.id}&categoryUuid=${categoryUuid}`);
      const entry = {};
      for (const [type, key] of [['SPR', 'sprint'], ['RAC', 'race']]) {
        const sess = sessions.find((x) => x.type === type);
        if (!sess) continue;
        await sleep(250);
        entry[key] = await getJSON(`${BASE}/results/session/${sess.id}/classification?test=false`);
      }
      if (entry.race) out.set(ev.date_start.slice(0, 10), entry);
    } catch (e) {
      console.warn('[motogp] result lookup failed for', ev.name, e.message);
    }
  }
  return out;
}

export async function fetchMotoGP({ year = new Date().getUTCFullYear(), withResults = true, prev } = {}) {
  const seasons = await getJSON(`${BASE}/results/seasons`);
  const season = seasons.find((s) => s.year === year);
  let categoryUuid = null;
  let standings = null;
  let summary = '';
  let allStandings = [];
  let results = new Map();
  if (season) {
    const cats = await getJSON(`${BASE}/results/categories?seasonUuid=${season.id}`);
    categoryUuid = cats.find((c) => /^MotoGP/i.test(c.name))?.id;
  }
  if (season && categoryUuid) {
    try {
      const st = await getJSON(`${BASE}/results/standings?seasonUuid=${season.id}&categoryUuid=${categoryUuid}`);
      allStandings = (st.classification || []).map((r) => ({
        pos: r.position,
        name: r.rider.full_name,
        team: r.team?.name || r.constructor?.name || '',
        pts: r.points,
      }));
    } catch (e) {
      console.warn('[motogp] standings unavailable:', e.message);
    }
    if (withResults) {
      try {
        results = await resultsFor(season.id, categoryUuid);
      } catch (e) {
        console.warn('[motogp] results unavailable:', e.message);
      }
    }
  }

  const events = [];
  for (const y of [year, year + 1]) {
    try {
      const list = (await getJSON(`${BASE}/events?seasonYear=${y}`))
        .filter((e) => e.kind === 'GP')
        .sort((a, b) => a.date_start.localeCompare(b.date_start));
      list.forEach((e, i) => events.push(mapEvent(e, y, i + 1, y === year ? results : new Map())));
    } catch (e) {
      console.warn(`[motogp] calendar ${y} unavailable:`, e.message);
    }
  }

  carryPredictions({ events }, prev);
  const thisYear = events.filter((e) => e.id.startsWith(`mgp-${year}-`));

  // Form model over this season's sprints and Grands Prix, in running order.
  const names = new Map();
  const teams = new Map();
  const ordered = [];
  for (const ev of thisYear) {
    const r = results.get(ev.start);
    if (!r) continue;
    for (const [key, sprint] of [['sprint', true], ['race', false]]) {
      const rows = r[key]?.classification;
      if (!rows?.length) continue;
      for (const x of rows) {
        names.set(x.rider.full_name, x.rider.full_name);
        teams.set(x.rider.full_name, x.team?.name || x.constructor?.name || '');
      }
      ordered.push({ eventId: ev.id, sprint, order: rows.map((x) => x.rider.full_name) });
    }
  }
  const theta = applyMotorsportModel({
    events: thisYear,
    results: ordered,
    names,
    teams,
    label: 'Form model: Plackett–Luce fit to this season’s sprint and Grand Prix finishing orders, recent rounds weighted more',
  });

  const left = thisYear.filter((e) => e.status === 'scheduled').length;
  if (allStandings.length) {
    let chances = null;
    if (theta && left) {
      // Every MotoGP weekend has a Saturday sprint as well as the Grand Prix.
      const remaining = Array.from({ length: left }, () => ({ sprint: true }));
      chances = titleChances(theta, new Map(allStandings.map((r) => [r.name, r.pts])), remaining, POINTS.motogp);
    }
    const rows = allStandings.slice(0, 5).map((r) => ({ ...r, ...(chances ? { titlePct: chances.get(r.name) ?? 0 } : {}) }));
    standings = {
      title: `Riders' championship ${year}`,
      rows,
      ...(chances ? { titleNote: `Title chances from 20,000 simulations of the ${left} remaining weekend${left === 1 ? '' : 's'} (sprint + Grand Prix) with the form model` } : {}),
    };
  }
  if (standings?.rows?.length > 1) {
    const [a, b] = standings.rows;
    summary = `${a.name} leads ${b.name} by ${a.pts - b.pts} points with ${left} round${left === 1 ? '' : 's'} left.`;
    if (a.titlePct !== undefined) summary += ` Title chances: ${a.name.split(' ').pop()} ${formatPct(a.titlePct)}, ${b.name.split(' ').pop()} ${formatPct(b.titlePct)}.`;
  }

  return {
    id: 'motogp',
    name: 'MotoGP',
    code: 'MGP',
    sport: 'motorsport',
    order: 2,
    season: String(year),
    summary,
    standings,
    source: { label: 'motogp.com results API', url: 'https://www.motogp.com/en/calendar' },
    events,
  };
}
