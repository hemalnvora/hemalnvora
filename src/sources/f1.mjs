// Formula 1 via the Jolpica API (the community successor to Ergast). No key needed.
import { getJSON, sleep } from './http.mjs';

const BASE = 'https://api.jolpi.ca/ergast/f1';

const SESSION_KEYS = [
  ['FirstPractice', 'FP1'],
  ['SecondPractice', 'FP2'],
  ['ThirdPractice', 'FP3'],
  ['SprintQualifying', 'Sprint quali'],
  ['Sprint', 'Sprint'],
  ['Qualifying', 'Qualifying'],
];

const iso = (date, time) => (date ? `${date}T${time || '00:00:00Z'}` : null);

function mapRace(r, winners) {
  const sessions = SESSION_KEYS.filter(([k]) => r[k]).map(([k, name]) => ({ name, time: iso(r[k].date, r[k].time) }));
  sessions.push({ name: 'Race', time: iso(r.date, r.time) });
  const firstDay = r.FirstPractice?.date || r.date;
  const w = winners.get(r.round);
  const raceTime = new Date(iso(r.date, r.time)).getTime();
  const done = Boolean(w) || raceTime + 3 * 3600e3 < Date.now();
  return {
    id: `f1-${r.season}-${String(r.round).padStart(2, '0')}`,
    round: Number(r.round),
    title: r.raceName,
    place: `${r.Circuit.circuitName}, ${r.Circuit.Location.locality}`,
    start: firstDay,
    end: r.date,
    time: iso(r.date, r.time),
    timeLabel: 'Race',
    sessions,
    status: done ? 'done' : 'scheduled',
    ...(w ? { result: `Winner: ${w}` } : {}),
    ...(r.Sprint ? { note: 'Sprint weekend' } : {}),
    link: r.url,
  };
}

export async function fetchF1({ year = new Date().getUTCFullYear(), fallbackNext } = {}) {
  const races = (await getJSON(`${BASE}/${year}/races/?format=json&limit=40`)).MRData.RaceTable.Races;
  await sleep(400);
  const winners = new Map();
  try {
    const res = (await getJSON(`${BASE}/${year}/results/1/?format=json&limit=40`)).MRData.RaceTable.Races;
    for (const r of res) {
      const x = r.Results?.[0];
      if (x) winners.set(r.round, `${x.Driver.givenName} ${x.Driver.familyName} (${x.Constructor.name})`);
    }
  } catch (e) {
    console.warn('[f1] winners unavailable:', e.message);
  }
  await sleep(400);
  let standings = null;
  let summary = '';
  try {
    const list = (await getJSON(`${BASE}/${year}/driverStandings/?format=json`)).MRData.StandingsTable.StandingsLists[0];
    if (list) {
      const rows = list.DriverStandings.slice(0, 5).map((s) => ({
        pos: Number(s.position),
        name: `${s.Driver.givenName} ${s.Driver.familyName}`,
        team: s.Constructors?.[0]?.name || '',
        pts: Number(s.points),
      }));
      const [a, b] = rows;
      const left = races.length - Number(list.round);
      standings = { title: `Drivers after round ${list.round}`, rows };
      if (a && b) summary = `${a.name} leads ${b.name} by ${a.pts - b.pts} points with ${left} round${left === 1 ? '' : 's'} left.`;
    }
  } catch (e) {
    console.warn('[f1] standings unavailable:', e.message);
  }

  const events = races.map((r) => mapRace(r, winners));

  // Next season: use the API when it has the calendar, otherwise the curated fallback.
  await sleep(400);
  let nextEvents = [];
  try {
    const next = (await getJSON(`${BASE}/${year + 1}/races/?format=json&limit=40`)).MRData.RaceTable.Races;
    nextEvents = next.map((r) => mapRace(r, new Map()));
  } catch (e) {
    console.warn('[f1] next season unavailable:', e.message);
  }
  if (!nextEvents.length && fallbackNext?.season === year + 1) {
    nextEvents = fallbackNext.events.map((e) => ({
      id: `f1-${fallbackNext.season}-${String(e.round).padStart(2, '0')}`,
      status: 'scheduled',
      ...e,
    }));
  }

  return {
    id: 'f1',
    name: 'Formula 1',
    code: 'F1',
    sport: 'motorsport',
    order: 1,
    season: String(year),
    summary,
    standings,
    source: { label: 'Jolpica F1 API', url: 'https://api.jolpi.ca/ergast/' },
    events: [...events, ...nextEvents],
  };
}
