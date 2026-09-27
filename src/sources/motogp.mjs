// MotoGP via the public API behind motogp.com (api.motogp.pulselive.com). No key needed.
import { getJSON, sleep, toUtcIso, titleCase } from './http.mjs';

const BASE = 'https://api.motogp.pulselive.com/motogp/v1';

const SESSIONS = { Q2: 'Qualifying', SPR: 'Sprint', RAC: 'Race' };

function mapEvent(e, year, seq, winners) {
  const sessions = (e.broadcasts || [])
    .filter((b) => b.category?.acronym === 'MGP' && b.type === 'SESSION' && SESSIONS[b.shortname])
    .map((b) => ({ name: SESSIONS[b.shortname], time: toUtcIso(b.date_start) }))
    .filter((s) => s.time)
    .sort((a, b) => a.time.localeCompare(b.time));
  const race = sessions.find((s) => s.name === 'Race');
  const start = e.date_start.slice(0, 10);
  const status = e.status === 'FINISHED' ? 'done' : /CANCEL/i.test(e.status || '') ? 'cancelled' : 'scheduled';
  const w = winners.get(start);
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
    ...(w ? { result: `Winner: ${w}` } : {}),
    // The API's `url` field is a slug ("Thailand") and `urls` are hospitality offers, so link the calendar.
    link: 'https://www.motogp.com/en/calendar',
  };
}

async function winnersFor(seasonUuid, categoryUuid) {
  const out = new Map();
  const finished = await getJSON(`${BASE}/results/events?seasonUuid=${seasonUuid}&isFinished=true`);
  for (const ev of finished.filter((x) => !x.test)) {
    try {
      await sleep(250);
      const sessions = await getJSON(`${BASE}/results/sessions?eventUuid=${ev.id}&categoryUuid=${categoryUuid}`);
      const race = sessions.find((s) => s.type === 'RAC');
      if (!race) continue;
      await sleep(250);
      const cls = await getJSON(`${BASE}/results/session/${race.id}/classification?test=false`);
      const p1 = cls.classification?.[0];
      if (p1) out.set(ev.date_start.slice(0, 10), `${p1.rider.full_name} (${p1.constructor?.name || p1.team?.name || ''})`.replace(' ()', ''));
    } catch (e) {
      console.warn('[motogp] winner lookup failed for', ev.name, e.message);
    }
  }
  return out;
}

export async function fetchMotoGP({ year = new Date().getUTCFullYear(), withWinners = true } = {}) {
  const seasons = await getJSON(`${BASE}/results/seasons`);
  const season = seasons.find((s) => s.year === year);
  let categoryUuid = null;
  let standings = null;
  let summary = '';
  let winners = new Map();
  if (season) {
    const cats = await getJSON(`${BASE}/results/categories?seasonUuid=${season.id}`);
    categoryUuid = cats.find((c) => /^MotoGP/i.test(c.name))?.id;
  }
  if (season && categoryUuid) {
    try {
      const st = await getJSON(`${BASE}/results/standings?seasonUuid=${season.id}&categoryUuid=${categoryUuid}`);
      const rows = (st.classification || []).slice(0, 5).map((r) => ({
        pos: r.position,
        name: r.rider.full_name,
        team: r.team?.name || r.constructor?.name || '',
        pts: r.points,
      }));
      if (rows.length) standings = { title: `Riders' championship ${year}`, rows };
    } catch (e) {
      console.warn('[motogp] standings unavailable:', e.message);
    }
    if (withWinners) {
      try {
        winners = await winnersFor(season.id, categoryUuid);
      } catch (e) {
        console.warn('[motogp] winners unavailable:', e.message);
      }
    }
  }

  const events = [];
  for (const y of [year, year + 1]) {
    try {
      const list = (await getJSON(`${BASE}/events?seasonYear=${y}`))
        .filter((e) => e.kind === 'GP')
        .sort((a, b) => a.date_start.localeCompare(b.date_start));
      list.forEach((e, i) => events.push(mapEvent(e, y, i + 1, y === year ? winners : new Map())));
    } catch (e) {
      console.warn(`[motogp] calendar ${y} unavailable:`, e.message);
    }
  }

  const thisYear = events.filter((e) => e.id.startsWith(`mgp-${year}-`));
  const left = thisYear.filter((e) => e.status === 'scheduled').length;
  if (standings?.rows?.length > 1) {
    const [a, b] = standings.rows;
    summary = `${a.name} leads ${b.name} by ${a.pts - b.pts} points with ${left} round${left === 1 ? '' : 's'} left.`;
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
