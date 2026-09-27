// Fetches the two live feeds (F1 via Jolpica, MotoGP via motogp.com) and writes one JSON file per
// series in the board's document shape. Used by the daily Claude refresh of the hosted board.
// Usage: node scripts/feeds.mjs <outDir>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchF1 } from '../src/sources/f1.mjs';
import { fetchMotoGP } from '../src/sources/motogp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'out');
const curated = JSON.parse(await readFile(path.join(root, 'data', 'curated.json'), 'utf8'));
await mkdir(outDir, { recursive: true });

const now = new Date().toISOString();
let failed = 0;
for (const [id, fetcher] of [
  ['f1', () => fetchF1({ fallbackNext: curated.fallbacks?.f1NextSeason })],
  ['motogp', () => fetchMotoGP()],
]) {
  try {
    const s = await fetcher();
    await writeFile(path.join(outDir, `${id}.json`), JSON.stringify({ ...s, updatedAt: now }));
    console.log(`${id}: ${s.events.length} events -> ${path.join(outDir, `${id}.json`)}`);
  } catch (err) {
    failed++;
    console.error(`${id}: FAILED (${err.message}); keep the existing document`);
  }
}
process.exit(failed ? 1 : 0);
