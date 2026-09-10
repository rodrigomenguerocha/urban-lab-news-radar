// Place → coordinates, via OpenStreetMap's Nominatim, with a permanent on-disk cache.
//
// The model names the place; this resolves it. Keeping the two apart matters: a
// language model approximates coordinates, and an approximate coordinate puts a pin
// in the wrong county. Every lookup is cached in site/data/geocache.json and
// committed, so a given place is queried once ever.
//
// Nominatim's usage policy caps automated use at one request per second and wants a
// identifying User-Agent. Both are honoured below. Volume here is a handful of new
// places a day.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, 'site/data/geocache.json');

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const CONTACT = 'https://github.com/rodrigomenguerocha/urban-lab-news-radar';
const RATE_LIMIT_MS = 1100;
const TIMEOUT_MS = 12_000;

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

// The model names places in free text, so the same city arrives spelled two ways
// across batches ("New York" and "New York City") and would become two map pins.
// Only exact aliases are listed: a general rule like stripping a trailing " City"
// would wrongly rewrite Tahoe City, California City and Kansas City.
const CITY_ALIASES = new Map(Object.entries({
  'new york city': 'New York',
  'nyc': 'New York',
  'washington, dc': 'Washington',
  'washington dc': 'Washington',
  'washington d.c.': 'Washington',
  'district of columbia': 'Washington',
  'los angeles city': 'Los Angeles',
  'san francisco city': 'San Francisco',
  'philadelphia city': 'Philadelphia',
  'boston city': 'Boston',
  'chicago city': 'Chicago',
}));

// Also canonicalise the CASE of any city the alias table already names, so
// "new york" and "New York" do not become two markers. Deliberately not a
// general title-case pass, which would turn McAllen into Mcallen.
const CANONICAL_CASE = new Map(
  [...CITY_ALIASES.values()].map((name) => [name.toLowerCase(), name]),
);

const lookupKey = (value) => value.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

/** Canonical spelling for a city, so one place yields one marker. */
export function canonicalCity(city) {
  let c = (city || '').replace(/\s+/g, ' ').trim();
  if (!c) return '';
  c = c.replace(/^(?:the\s+)?(?:city|town|village|borough)\s+of\s+/i, '');
  c = c.replace(/,?\s*(?:usa|u\.s\.a\.|united states)$/i, '').trim();
  const key = lookupKey(c);
  return CITY_ALIASES.get(key) || CANONICAL_CASE.get(key) || c;
}

/** A stable label for the place, and the string handed to the geocoder. */
export function placeLabel(city, state) {
  const c = canonicalCity(city);
  const s = (state || '').trim().toUpperCase();
  if (c && s) return `${c}, ${s}`;
  if (c) return c;
  if (s) return s;
  return '';
}

function queryFor(city, state) {
  const c = canonicalCity(city);
  const s = (state || '').trim().toUpperCase();
  if (c && US_STATES.has(s)) return `${c}, ${s}, United States`;
  if (US_STATES.has(s)) return `${s}, United States`;
  return c;
}

export async function loadCache() {
  try {
    const parsed = JSON.parse(await readFile(CACHE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveCache(cache) {
  await mkdir(dirname(CACHE), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(CACHE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(query) {
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&addressdetails=0`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'User-Agent': `urban-lab-news-radar/1.0 (+${CONTACT})`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const hit = Array.isArray(body) ? body[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };
}

/**
 * Attaches lat/lng to every item that names a place. Items with no place, or a place
 * the geocoder cannot resolve, are left without coordinates and simply do not appear
 * on the map. Returns { resolved, missed, queried }.
 */
export async function geocodeItems(items, { log = console } = {}) {
  const cache = await loadCache();
  let queried = 0;
  let resolved = 0;
  const missed = new Set();

  // Unique places first, so ten articles about Austin cost one lookup.
  const wanted = new Map();
  for (const it of items) {
    const label = placeLabel(it.city, it.state);
    if (!label) continue;
    if (!wanted.has(label)) wanted.set(label, queryFor(it.city, it.state));
  }

  for (const [label, query] of wanted) {
    if (label in cache) continue;
    if (!query) {
      cache[label] = null;
      continue;
    }
    if (queried > 0) await sleep(RATE_LIMIT_MS);
    queried += 1;
    try {
      cache[label] = await lookup(query);
    } catch (err) {
      log.warn?.(`  geocode "${label}": ${err.message}`);
      // Left out of the cache so the next run retries it.
    }
  }

  for (const it of items) {
    it.city = canonicalCity(it.city);
    const label = placeLabel(it.city, it.state);
    it.place = label;
    const hit = label ? cache[label] : null;
    if (hit) {
      it.lat = hit.lat;
      it.lng = hit.lng;
      resolved += 1;
    } else {
      delete it.lat;
      delete it.lng;
      if (label) missed.add(label);
    }
  }

  await saveCache(cache);
  log.info?.(`  geocode: ${resolved} placed, ${queried} new lookups, ${missed.size} unresolved`);
  return { resolved, missed: [...missed], queried };
}
