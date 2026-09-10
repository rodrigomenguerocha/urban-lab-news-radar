// Feed reading. Every failure is a warning: one dead source never stops a run.

import Parser from 'rss-parser';
import { USER_AGENT, SOURCES, hostOf } from './sources.mjs';

const parser = new Parser();
const FETCH_TIMEOUT_MS = 20_000;

/** rss-parser's own timeout does not cover every stall, and a hung feed would hang
 *  the whole cron run. Fetch with a hard abort, then parse the text we already hold. */
async function fetchFeed(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text)) throw new Error('response is not a feed');
  return parser.parseString(text);
}

const TAG = /<[^>]+>/g;
const WS = /\s+/g;

function clean(raw) {
  if (!raw) return '';
  return raw
    .replace(TAG, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(WS, ' ')
    .trim();
}

function isoDate(entry) {
  const raw = entry.isoDate || entry.pubDate;
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Google News wraps each item's title as "Headline - Outlet" and names the
 *  outlet in <source>. Split them so the stored source is the real publisher. */
function publisherOf(entry, source) {
  const named = entry.source?.title || entry.source?.$?.url;
  if (source.kind !== 'gnews') return source.name;
  if (typeof named === 'string' && named.trim()) return clean(named);
  const m = /\s-\s([^-]{2,40})$/.exec(entry.title || '');
  return m ? clean(m[1]) : 'Google News';
}

function titleOf(entry, source) {
  const t = clean(entry.title);
  if (source.kind !== 'gnews') return t;
  return t.replace(/\s-\s[^-]{2,40}$/, '').trim() || t;
}

function snippetOf(entry, source) {
  // Google News puts a bare anchor in the description: no article text to take.
  if (source.kind === 'gnews') return '';
  const parts = [entry['content:encoded'], entry.content, entry.contentSnippet, entry.summary];
  for (const p of parts) {
    const c = clean(p);
    if (c.length > 120) return c.slice(0, 3000);
  }
  return clean(entry.contentSnippet || entry.content || '').slice(0, 3000);
}

export async function readSource(source) {
  const feed = await fetchFeed(source.url);
  const items = (feed.items || []).slice(0, source.cap);
  const out = [];
  for (const entry of items) {
    const url = entry.link || entry.guid;
    const title = titleOf(entry, source);
    if (!url || !title) continue;
    out.push({
      title,
      url,
      source: publisherOf(entry, source),
      host: hostOf(url),
      published: isoDate(entry),
      snippet: snippetOf(entry, source),
      feed: source.id,
      headlineOnly: source.kind === 'gnews',
    });
  }
  return out;
}

export async function readAll(log = console) {
  const results = await Promise.allSettled(SOURCES.map((s) => readSource(s)));
  const all = [];
  const stats = [];
  results.forEach((r, i) => {
    const s = SOURCES[i];
    if (r.status === 'fulfilled') {
      stats.push({ id: s.id, count: r.value.length, ok: true });
      log.info?.(`  ${String(r.value.length).padStart(3)} from ${s.id}`);
      all.push(...r.value);
    } else {
      stats.push({ id: s.id, count: 0, ok: false, error: String(r.reason?.message || r.reason) });
      log.warn?.(`  ERR ${s.id}: ${r.reason?.message || r.reason}`);
    }
  });
  return { articles: all, stats };
}
