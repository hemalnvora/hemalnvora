// Single-file helper for the hosted board's daily refresh. `npm run build:kit` bundles it to
// dist/board-kit.mjs, which is published next to the page as tools/board-kit.mjs, so the
// routine can download and run it without a checkout of this repository.
//   node board-kit.mjs feeds <outDir>        writes f1.json and motogp.json in the board's document shape
//   node board-kit.mjs validate <path> [...]  checks series and buzz documents (files or directories)
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import curated from '../data/curated.json' with { type: 'json' };
import { fetchF1 } from '../src/sources/f1.mjs';
import { fetchMotoGP } from '../src/sources/motogp.mjs';
import { checkDocument } from '../src/validate-lib.mjs';

async function feeds(outDir) {
  await mkdir(outDir, { recursive: true });
  const now = new Date().toISOString();
  let failed = 0;
  for (const [id, fetcher] of [
    ['f1', () => fetchF1({ fallbackNext: curated.fallbacks?.f1NextSeason })],
    ['motogp', () => fetchMotoGP()],
  ]) {
    try {
      const s = await fetcher();
      const file = path.join(outDir, `${id}.json`);
      await writeFile(file, JSON.stringify({ ...s, updatedAt: now }));
      console.log(`${id}: ${s.events.length} events -> ${file}`);
    } catch (err) {
      failed++;
      console.error(`${id}: FAILED (${err.message}); keep the existing document`);
    }
  }
  return failed ? 1 : 0;
}

async function validate(paths) {
  let bad = 0;
  for (const p of paths) {
    const list = (await stat(p)).isDirectory()
      ? (await readdir(p)).filter((f) => f.endsWith('.json')).map((f) => path.join(p, f))
      : [p];
    for (const f of list) {
      let doc;
      try {
        doc = JSON.parse(await readFile(f, 'utf8'));
      } catch (err) {
        console.log(`✗ ${f}: invalid JSON (${err.message})`);
        bad++;
        continue;
      }
      if (doc.refreshedAt && !doc.events && !doc.items) { console.log(`- ${f} (status, skipped)`); continue; }
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
if (cmd === 'feeds') process.exit(await feeds(args[0] || 'out'));
else if (cmd === 'validate' && args.length) process.exit(await validate(args));
else {
  console.log('usage: node board-kit.mjs feeds <outDir> | validate <path> [...]');
  process.exit(2);
}
