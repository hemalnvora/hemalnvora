// Writes dist/paddock-pavilion.html: the page fragment with data/latest.json inlined as its
// fallback snapshot. That file is what gets published as the hosted (claude.ai) board.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFragment } from '../src/page.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(path.join(root, 'data', 'latest.json'), 'utf8'));
const out = path.join(root, 'dist', 'paddock-pavilion.html');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, await buildFragment(data));
console.log(`wrote ${path.relative(root, out)} (${data.series.length} series)`);
