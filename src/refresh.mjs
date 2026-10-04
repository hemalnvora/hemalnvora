// Builds data/latest.json: live F1 + MotoGP feeds, merged with the curated (or Claude-researched) series.
// Usage: node src/refresh.mjs [--research]
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchF1 } from './sources/f1.mjs';
import { fetchMotoGP } from './sources/motogp.mjs';
import { applyCricketRatings } from './predict.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
const CURATED_DIR = path.join(here, '..', 'data');

async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJSON(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1));
  await rename(tmp, file);
}

export async function refresh({ research = false, log = console.log } = {}) {
  const now = new Date().toISOString();
  const curated = await readJSON(path.join(CURATED_DIR, 'curated.json'));
  if (!curated) throw new Error('data/curated.json is missing or invalid');
  const prev = await readJSON(path.join(DATA_DIR, 'latest.json'));
  const researchedFile = path.join(DATA_DIR, 'researched.json');
  let researched = await readJSON(researchedFile);

  // A hand edit of curated.json (newer curatedAt) wins over an older research run.
  if (researched && researched.researchedAt < curated.curatedAt) researched = null;

  let curatedSeries = researched?.series ?? curated.series;
  let buzz = researched?.buzz ?? curated.buzz;

  if (research) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      log('[refresh] research skipped: ANTHROPIC_API_KEY is not set');
    } else {
      const { researchAll } = await import('./research.mjs');
      const r = await researchAll({ curatedSeries, buzz, log });
      if (r) {
        await writeJSON(researchedFile, r);
        curatedSeries = r.series;
        buzz = r.buzz;
      }
    }
  }

  const structured = [];
  const feeds = [
    ['f1', (prevSeries) => fetchF1({ fallbackNext: curated.fallbacks?.f1NextSeason, prev: prevSeries })],
    ['motogp', (prevSeries) => fetchMotoGP({ prev: prevSeries })],
  ];
  for (const [id, fetcher] of feeds) {
    try {
      // The previous copy keeps pre-race predictions for races that have since finished.
      const s = await fetcher(prev?.series?.find((x) => x.id === id));
      structured.push({ ...s, updatedAt: now });
      log(`[refresh] ${id}: ${s.events.length} events`);
    } catch (err) {
      const old = prev?.series?.find((s) => s.id === id);
      log(`[refresh] ${id}: feed failed (${err.message}); ${old ? 'keeping last good copy' : 'no previous copy'}`);
      if (old) structured.push({ ...old, stale: true });
    }
  }

  const series = [...structured, ...curatedSeries.map((s) => ({ updatedAt: researched?.researchedAt || curated.curatedAt, ...s }))]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  // Cricket win chances from ICC ratings (curated, or refreshed by the research step).
  const ratings = researched?.cricketRatings ?? curated.cricketRatings;
  for (const s of series) if (s.sport === 'cricket') applyCricketRatings(s, ratings);

  const out = {
    generatedAt: now,
    researchedAt: researched?.researchedAt || null,
    curatedAt: curated.curatedAt,
    series,
    buzz,
    ...(ratings ? { cricketRatings: ratings } : {}),
  };
  await writeJSON(path.join(DATA_DIR, 'latest.json'), out);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refresh({ research: process.argv.includes('--research') })
    .then((d) => console.log(`[refresh] wrote ${d.series.length} series, ${d.series.reduce((n, s) => n + s.events.length, 0)} events`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
