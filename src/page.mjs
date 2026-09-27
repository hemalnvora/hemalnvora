// Turns web/index.html (a page fragment, the same file published as the hosted artifact)
// into a full document with the latest data inlined, so it renders complete on first paint.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'web', 'index.html');

export function inlineSnapshot(fragment, data) {
  // Escape "<" so the JSON can never close the <script> tag it lives in.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return fragment.split('__SNAPSHOT_JSON__').join(json);
}

export async function buildFragment(data) {
  return inlineSnapshot(await readFile(PAGE, 'utf8'), data);
}

export async function buildDocument(data) {
  const body = await buildFragment(data);
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>',
    '</head><body>',
    body,
    '</body></html>',
  ].join('');
}
