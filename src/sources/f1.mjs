// Formula 1 via the Jolpica API (the community successor to Ergast). No key needed.
import { getJSON, sleep } from './http.mjs';
import { applyMotorsportModel, applyGrid, carryPredictions, titleChances, formatPct, GRID_BETA, POINTS } from '../predict.mjs';

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
const driverName = (d) => `${d.givenName} ${d.familyName}`;

// Every result row of a season, merged per round (the API pages at 100 rows).
async function allRounds(path, key) {
  const byRound = new Map();
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const d = (await getJSON(`${BASE}/${path}?format=json&limit=100&offset=${offset}`)).MRData;
    total = Number(d.total);
    for (const r of d.RaceTable.Races) {
      const ex = byRound.get(r.round);
      if (ex) ex[key].push(...r[key]);
      else byRound.set(r.round, { ...r, [key]: [...r[key]] });
    }
    offset += 100;
    await sleep(300);
  }
  for (const r of byRound.values()) r[key].sort((a, b) => Number(a.position) - Number(b.position));
  return byRound;
}

function resultDetails(res, sprint) {
  if (!res?.Results?.length) return {};
  const rows = res.Results;
  const podium = rows.slice(0, 3).map((x) => ({
    pos: Number(x.position),
    name: driverName(x.Driver),
    team: x.Constructor.name,
    detail: x.Time?.time ? (x.position === '1' ? x.Time.time : `${x.Time.time}s`) : x.status,
  }));
  const highlights = [];
  const pole = rows.find((x) => x.grid === '1');
  if (pole) highlights.push(`Pole: ${driverName(pole.Driver)}`);
  const fl = rows.find((x) => x.FastestLap?.rank === '1');
  if (fl) highlights.push(`Fastest lap: ${driverName(fl.Driver)} (${fl.FastestLap.Time?.time})`);
  const sp = sprint?.SprintResults?.[0];
  if (sp) highlights.push(`Sprint won by ${driverName(sp.Driver)}`);
  const retired = rows.filter((x) => !/^(Finished|\+\d+ Laps?|Lapped)$/.test(x.status)).length;
  if (retired) highlights.push(`${retired} retirement${retired === 1 ? '' : 's'}`);
  return { podium, winner: podium[0].name, highlights, result: `Winner: ${podium[0].name} (${podium[0].team})` };
}

function mapRace(r, results, sprints) {
  const sessions = SESSION_KEYS.filter(([k]) => r[k]).map(([k, name]) => ({ name, time: iso(r[k].date, r[k].time) }));
  sessions.push({ name: 'Race', time: iso(r.date, r.time) });
  const firstDay = r.FirstPractice?.date || r.date;
  const res = results.get(r.round);
  const raceTime = new Date(iso(r.date, r.time)).getTime();
  const done = Boolean(res) || raceTime + 3 * 3600e3 < Date.now();
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
    ...resultDetails(res, sprints.get(r.round)),
    ...(r.Sprint ? { note: 'Sprint weekend', sprint: true } : {}),
    link: r.url,
  };
}

export async function fetchF1({ year = new Date().getUTCFullYear(), fallbackNext, prev } = {}) {
  const races = (await getJSON(`${BASE}/${year}/races/?format=json&limit=40`)).MRData.RaceTable.Races;
  await sleep(400);
  let results = new Map();
  let sprints = new Map();
  try {
    results = await allRounds(`${year}/results/`, 'Results');
    sprints = await allRounds(`${year}/sprint/`, 'SprintResults');
  } catch (e) {
    console.warn('[f1] results unavailable:', e.message);
  }

  const events = races.map((r) => mapRace(r, results, sprints));
  carryPredictions({ events }, prev);

  // Form model over this season's sprints and races, in running order.
  const names = new Map();
  const teams = new Map();
  const ordered = [];
  for (const r of races) {
    const id = `f1-${r.season}-${String(r.round).padStart(2, '0')}`;
    for (const [src, key, sprint] of [[sprints, 'SprintResults', true], [results, 'Results', false]]) {
      const rr = src.get(r.round);
      if (!rr) continue;
      for (const x of rr[key]) {
        names.set(x.Driver.driverId, driverName(x.Driver));
        teams.set(x.Driver.driverId, x.Constructor.name);
      }
      ordered.push({ eventId: id, sprint, order: rr[key].map((x) => x.Driver.driverId) });
    }
  }
  const current = events.filter((e) => e.id.startsWith(`f1-${year}-`));
  const theta = applyMotorsportModel({
    events: current,
    results: ordered,
    names,
    teams,
    label: 'Form model: Plackett–Luce fit to this season’s race and sprint finishing orders, recent rounds weighted more',
  });

  // Once qualifying is done for the next race, fold the qualifying order into its chances.
  const nextRace = current.find((e) => e.status === 'scheduled');
  if (theta && nextRace) {
    try {
      await sleep(400);
      const q = (await getJSON(`${BASE}/${year}/${nextRace.round}/qualifying/?format=json`)).MRData.RaceTable.Races[0];
      const grid = new Map((q?.QualifyingResults || []).map((x) => [x.Driver.driverId, Number(x.position)]));
      for (const x of q?.QualifyingResults || []) { names.set(x.Driver.driverId, driverName(x.Driver)); teams.set(x.Driver.driverId, x.Constructor.name); }
      applyGrid(nextRace, theta, grid, { beta: GRID_BETA.f1, names, teams, label: 'After qualifying: form model combined with the qualifying order (grid penalties not included)' });
    } catch (e) {
      console.warn('[f1] qualifying unavailable:', e.message);
    }
  }

  await sleep(400);
  let standings = null;
  let summary = '';
  try {
    const list = (await getJSON(`${BASE}/${year}/driverStandings/?format=json&limit=40`)).MRData.StandingsTable.StandingsLists[0];
    if (list) {
      const all = list.DriverStandings.map((s) => ({
        key: s.Driver.driverId,
        pos: Number(s.position),
        name: driverName(s.Driver),
        team: s.Constructors?.[0]?.name || '',
        pts: Number(s.points),
      }));
      const remaining = current.filter((e) => e.status === 'scheduled').map((e) => ({ sprint: Boolean(e.sprint) }));
      let chances = null;
      if (theta && remaining.length) chances = titleChances(theta, new Map(all.map((r) => [r.key, r.pts])), remaining, POINTS.f1);
      const rows = all.slice(0, 5).map(({ key, ...r }) => ({ ...r, ...(chances ? { titlePct: chances.get(key) ?? 0 } : {}) }));
      const [a, b] = rows;
      const left = remaining.length;
      standings = {
        title: `Drivers after round ${list.round}`,
        rows,
        ...(chances ? { titleNote: `Title chances from 20,000 simulations of the ${left} remaining round${left === 1 ? '' : 's'} with the form model` } : {}),
      };
      if (a && b) summary = `${a.name} leads ${b.name} by ${a.pts - b.pts} points with ${left} round${left === 1 ? '' : 's'} left.`;
      if (a?.titlePct !== undefined) summary += ` Title chances: ${a.name.split(' ').pop()} ${formatPct(a.titlePct)}, ${b.name.split(' ').pop()} ${formatPct(b.titlePct)}.`;
    }
  } catch (e) {
    console.warn('[f1] standings unavailable:', e.message);
  }

  // Next season: use the API when it has the calendar, otherwise the curated fallback.
  await sleep(400);
  let nextEvents = [];
  try {
    const next = (await getJSON(`${BASE}/${year + 1}/races/?format=json&limit=40`)).MRData.RaceTable.Races;
    nextEvents = next.map((r) => mapRace(r, new Map(), new Map()));
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
