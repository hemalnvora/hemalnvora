// Checks board documents before they are written. Exits 1 on any problem.
// Usage: node scripts/validate.mjs <file-or-dir> [...]
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { checkDocument } from '../src/validate-lib.mjs';

async function files(p) {
  if ((await stat(p)).isDirectory()) return (await readdir(p)).filter((f) => f.endsWith('.json')).map((f) => path.join(p, f));
  return [p];
}

let bad = 0;
for (const arg of process.argv.slice(2)) {
  for (const f of await files(arg)) {
    let doc;
    try {
      doc = JSON.parse(await readFile(f, 'utf8'));
    } catch (err) {
      console.log(`✗ ${f}: invalid JSON (${err.message})`);
      bad++;
      continue;
    }
    const errs = checkDocument(doc);
    if (errs.length) {
      bad++;
      console.log(`✗ ${f}\n  - ${errs.join('\n  - ')}`);
    } else {
      console.log(`✓ ${f}`);
    }
  }
}
process.exit(bad ? 1 : 0);
