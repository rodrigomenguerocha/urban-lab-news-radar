#!/usr/bin/env node
// Urban Lab News Radar — daily collector.
//
//   node collector/collect.mjs              collect, classify, write site/data/articles.json
//   node collector/collect.mjs --dry-run    read feeds and list candidates, no API call
//   node collector/collect.mjs --limit 20   cap how many candidates reach the API
//
// Needs ANTHROPIC_API_KEY in the environment (except with --dry-run).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAll } from './feeds.mjs';
import { classify, MODEL } from './classify.mjs';
import { backfillImages } from './images.mjs';
import { AREAS, hostOf, isPaywalled } from './sources.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'site/data/articles.json');
const MAX_CANDIDATES = 60;   // ceiling on one run's API spend
const KEEP_DAYS = 400;       // prune anything collected longer ago than this

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : Number(argv[i + 1]) || fallback;
};

const DRY_RUN = flag('--dry-run');
const LIMIT = value('--limit', MAX_CANDIDATES);
const today = new Date().toISOString().slice(0, 10);

function normalise(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return (url || '').toLowerCase();
  }
}

function slugify(raw, taken) {
  let base = String(raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'article';
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

/** Round-robin the candidates across feeds so the per-run cap takes the top items
 *  from every source instead of exhausting whichever feed was read first. */
function interleave(list) {
  const byFeed = new Map();
  for (const a of list) {
    if (!byFeed.has(a.feed)) byFeed.set(a.feed, []);
    byFeed.get(a.feed).push(a);
  }
  const queues = [...byFeed.values()];
  const out = [];
  for (let row = 0; out.length < list.length; row += 1) {
    let placed = false;
    for (const q of queues) {
      if (row < q.length) { out.push(q[row]); placed = true; }
    }
    if (!placed) break;
  }
  return out;
}

async function loadExisting() {
  try {
    const parsed = JSON.parse(await readFile(DATA, 'utf8'));
    return {
      updated: parsed.updated || '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`! could not read ${DATA}: ${err.message}`);
    return { updated: '', items: [] };
  }
}

function stepSummary(lines) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return Promise.resolve();
  return writeFile(path, lines.join('\n') + '\n', { flag: 'a' }).catch(() => {});
}

async function main() {
  console.log(`Urban Lab News Radar — collection for ${today}`);

  const existing = await loadExisting();
  const seenIds = new Set(existing.items.map((i) => i.id));
  const seenUrls = new Set(existing.items.map((i) => normalise(i.url)));
  console.log(`Already recorded: ${existing.items.length} articles\n`);

  console.log('Reading sources:');
  const { articles, stats } = await readAll(console);

  // Drop anything already recorded, and duplicates inside this run.
  const batchUrls = new Set();
  const candidates = [];
  for (const a of articles) {
    const key = normalise(a.url);
    if (seenUrls.has(key) || batchUrls.has(key)) continue;
    batchUrls.add(key);
    candidates.push(a);
  }
  console.log(`\n${articles.length} fetched · ${articles.length - candidates.length} already known · ${candidates.length} new`);

  const queue = interleave(candidates).slice(0, LIMIT);
  if (queue.length < candidates.length) {
    console.log(`Capped at ${queue.length} candidates this run (raise with --limit).`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no API call. Candidates that would be screened:\n');
    queue.forEach((c, i) => {
      const marks = [c.headlineOnly ? 'headline-only' : `${c.snippet.length} chars`];
      if (isPaywalled(c.url)) marks.push('paywalled');
      console.log(`  ${String(i + 1).padStart(3)}. [${c.source}] ${c.title.slice(0, 80)}`);
      console.log(`       ${c.published || 'no date'} · ${c.host} · ${marks.join(' · ')}`);
    });
    return 0;
  }

  if (!queue.length) {
    console.log('\nNothing new to screen.');
    await stepSummary([`### Urban Lab News Radar — ${today}`, '', 'No new articles.']);
    return 0;
  }

  console.log(`\nScreening with ${MODEL}:`);
  const { decisions, usage, failedBatches } = await classify(queue, { log: console });

  const takenSlugs = new Set(seenIds);
  const added = [];
  const rejected = [];

  queue.forEach((c, i) => {
    const d = decisions.get(i);
    if (!d) return;                       // batch failed: try again tomorrow
    if (!d.relevant) {
      rejected.push({ title: c.title, reason: d.reason || 'not relevant' });
      return;
    }
    if (!AREAS.includes(d.tag)) {
      rejected.push({ title: c.title, reason: `invalid tag "${d.tag}"` });
      return;
    }
    let summary = (d.summary || '').trim();
    if (isPaywalled(c.url)) summary = '(paywall)';
    else if (c.headlineOnly && summary && summary.length < 40) summary = '';

    added.push({
      id: slugify(d.slug, takenSlugs),
      title: c.title,
      source: c.source,
      url: c.url,
      date: c.published || '',           // the feed's date, never the model's guess
      summary,
      image: c.image || '',
      tag: d.tag,
      found: today,
    });
  });

  // Thumbnails are a nice-to-have: look for one only on the items just added.
  if (added.length) {
    console.log('\nLooking for thumbnails:');
    await backfillImages(added, { log: console });
  }

  // Merge, newest collection first, and prune very old entries.
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const merged = [...existing.items, ...added]
    .filter((i) => !i.found || i.found >= cutoff)
    .sort((a, b) =>
      a.found !== b.found ? (a.found < b.found ? 1 : -1)
        : (a.date || '') !== (b.date || '') ? ((a.date || '') < (b.date || '') ? 1 : -1)
          : a.title.localeCompare(b.title));

  await mkdir(dirname(DATA), { recursive: true });
  await writeFile(
    DATA,
    JSON.stringify({ updated: today, model: MODEL, count: merged.length, items: merged }, null, 2) + '\n',
    'utf8',
  );

  const byArea = AREAS.map((a) => [a, added.filter((i) => i.tag === a).length]).filter(([, n]) => n);

  console.log(`\n${added.length} added · ${rejected.length} rejected · ${merged.length} total`);
  byArea.forEach(([a, n]) => console.log(`  ${String(n).padStart(3)}  ${a}`));
  added.forEach((i) => console.log(`  + [${i.source}] ${i.title.slice(0, 78)}`));
  if (failedBatches) console.log(`! ${failedBatches} batch(es) failed and were skipped`);
  console.log(`Tokens: ${usage.inputTokens} in / ${usage.outputTokens} out over ${usage.calls} calls`);

  const deadSources = stats.filter((s) => !s.ok);
  await stepSummary([
    `### Urban Lab News Radar — ${today}`,
    '',
    `**${added.length} added** · ${rejected.length} rejected · ${merged.length} total · model \`${MODEL}\``,
    '',
    ...byArea.map(([a, n]) => `- ${n} × ${a}`),
    '',
    ...(added.length ? ['| Area | Source | Headline |', '|---|---|---|',
      ...added.map((i) => `| ${i.tag} | ${i.source} | [${i.title.replace(/\|/g, '\\|')}](${i.url}) |`)] : []),
    '',
    ...(deadSources.length ? ['', `⚠️ sources that failed: ${deadSources.map((s) => `${s.id} (${s.error})`).join(', ')}`] : []),
  ]);

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`\nFATAL: ${err.message}`);
    process.exit(1);
  },
);
