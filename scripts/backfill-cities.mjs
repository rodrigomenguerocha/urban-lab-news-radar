#!/usr/bin/env node
// Adds city/state and coordinates to articles already stored, for the map view.
//   ANTHROPIC_API_KEY=... node scripts/backfill-cities.mjs [--force]
//
// Without --force it only touches articles that have no city recorded yet.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPlaces } from '../collector/classify.mjs';
import { geocodeItems } from '../collector/geocode.mjs';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site/data/articles.json');
const force = process.argv.includes('--force');

const data = JSON.parse(await readFile(DATA, 'utf8'));
const targets = data.items.filter((i) => force || i.city === undefined);
if (!targets.length) {
  console.log('Every article already has a place. Use --force to redo them.');
  process.exit(0);
}

console.log(`Extracting places for ${targets.length} of ${data.items.length} articles:`);
const { places, usage } = await extractPlaces(targets, { log: console });
targets.forEach((it, i) => {
  const p = places.get(i);
  it.city = (p?.city || '').trim();
  it.state = (p?.state || '').trim().toUpperCase();
});

console.log('\nResolving coordinates:');
await geocodeItems(data.items, { log: console });

await writeFile(DATA, JSON.stringify(data, null, 2) + '\n', 'utf8');
const placed = data.items.filter((i) => i.lat !== undefined).length;
const national = data.items.filter((i) => !i.place).length;
console.log(`\n${placed}/${data.items.length} articles are on the map.`);
console.log(`${national} have no single place (national or federal stories).`);
console.log(`Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out over ${usage.calls} calls.`);
