// Single-file helper for the hosted board's daily refresh. `npm run build:kit` bundles it to
// dist/board-kit.mjs, which is published next to the page as tools/board-kit.mjs, so the
// routine can download and run it without a checkout of this repository.
//   node board-kit.mjs feeds <outDir> [--prev <dir>]   write f1.json and motogp.json (results, podiums,
//                                                       win chances, title chances). --prev points at the
//                                                       current documents so pre-race predictions are kept.
//   node board-kit.mjs predict <dir> --ratings <file>  fill cricket win chances from ICC ratings
//   node board-kit.mjs validate <path> [...]           check series, buzz and ratings documents
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import curated from '../data/curated.json' with { type: 'json' };
import { fetchF1 } from '../src/sources/f1.mjs';
import { fetchMotoGP } from '../src/sources/motogp.mjs';
import { applyCricketRatings } from '../src/predict.mjs';
import { checkDocument } from '../src/validate-lib.mjs';

const readJSON = async (f) => {
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch {
    return null;
  }
};

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

async function jsonFiles(p) {
  if ((await stat(p)).isDirectory()) return (await readdir(p)).filter((f) => f.endsWith('.json')).map((f) => path.join(p, f));
  return [p];
}

async function feeds(outDir, prevDir) {
  await mkdir(outDir, { recursive: true });
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  let failed = 0;
  for (const [id, fetcher] of [
    ['f1', (prev) => fetchF1({ fallbackNext: curated.fallbacks?.f1NextSeason, prev })],
    ['motogp', (prev) => fetchMotoGP({ prev })],
  ]) {
    try {
      const prev = prevDir ? await readJSON(path.join(prevDir, `${id}.json`)) : null;
      const s = await fetcher(prev);
      const file = path.join(outDir, `${id}.json`);
      await writeFile(file, JSON.stringify({ ...s, updatedAt: now }));
      const next = s.events.find((e) => e.status === 'scheduled' && e.prediction);
      console.log(`${id}: ${s.events.length} events -> ${file}${next ? ` (next: ${next.title}, favourite ${next.prediction.picks[0].name} ${next.prediction.picks[0].pct}%)` : ''}`);
    } catch (err) {
      failed++;
      console.error(`${id}: FAILED (${err.message}); keep the existing document`);
    }
  }
  return failed ? 1 : 0;
}

async function predict(dir, ratingsFile) {
  const ratings = await readJSON(ratingsFile);
  if (!ratings) {
    console.error(`cannot read ratings from ${ratingsFile}`);
    return 1;
  }
  for (const f of await jsonFiles(dir)) {
    const doc = await readJSON(f);
    if (!doc || doc.sport !== 'cricket' || !Array.isArray(doc.events)) continue;
    const n = applyCricketRatings(doc, ratings);
    await writeFile(f, JSON.stringify(doc));
    const today = new Date().toISOString().slice(0, 10);
    const missing = doc.events.filter((e) => e.status === 'scheduled' && e.start >= today && e.teams && e.format && !e.prediction).map((e) => e.id);
    console.log(`${path.basename(f)}: ${n} match predictions${missing.length ? `; no rating for ${missing.join(', ')}` : ''}`);
  }
  return 0;
}

async function validate(paths) {
  let bad = 0;
  for (const p of paths) {
    for (const f of await jsonFiles(p)) {
      const doc = await readJSON(f);
      if (!doc) {
        console.log(`✗ ${f}: invalid JSON`);
        bad++;
        continue;
      }
      if (doc.refreshedAt && !doc.events && !doc.items) {
        console.log(`- ${f} (status, skipped)`);
        continue;
      }
      const errs = checkDocument(doc);
      if (errs.length) {
        bad++;
        console.log(`✗ ${f}\n  - ${errs.join('\n  - ')}`);
      } else console.log(`✓ ${f}`);
    }
  }
  return bad ? 1 : 0;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'feeds') process.exit(await feeds(args[0] || 'out', flag(args, '--prev')));
else if (cmd === 'predict' && args[0] && flag(args, '--ratings')) process.exit(await predict(args[0], flag(args, '--ratings')));
else if (cmd === 'validate' && args.length) process.exit(await validate(args));
else {
  console.log('usage: node board-kit.mjs feeds <outDir> [--prev <dir>] | predict <dir> --ratings <file> | validate <path> [...]');
  process.exit(2);
}
