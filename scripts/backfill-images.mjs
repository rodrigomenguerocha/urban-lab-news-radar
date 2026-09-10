#!/usr/bin/env node
// One-off / occasional: look for a thumbnail on every stored article that lacks one.
//   node scripts/backfill-images.mjs [--limit 200]

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backfillImages } from '../collector/images.mjs';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site/data/articles.json');
const i = process.argv.indexOf('--limit');
const limit = i === -1 ? 200 : Number(process.argv[i + 1]) || 200;

const data = JSON.parse(await readFile(DATA, 'utf8'));
const before = data.items.filter((x) => x.image).length;
await backfillImages(data.items, { limit, log: console });
const after = data.items.filter((x) => x.image).length;

await writeFile(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
const google = data.items.filter((x) => /news\.google\.com/.test(x.url)).length;
console.log(`${after}/${data.items.length} articles have a thumbnail (was ${before}).`);
console.log(`${google} are Google News links, which cannot be resolved to an article page.`);
