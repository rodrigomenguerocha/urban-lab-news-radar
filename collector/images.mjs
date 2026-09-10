// Thumbnail discovery. Best-effort by design: most items end up without one.
//
// Two sources, cheapest first:
//   1. the feed itself — media:content, media:thumbnail, an image enclosure, or the
//      first <img> in the encoded content. Free, but only a couple of feeds carry it.
//   2. og:image on the article page. One extra HTTP request per item, and many
//      publishers answer 403 to a datacenter IP, so this is capped and never retried.
//
// Google News items are skipped outright: their link is a redirect that needs
// JavaScript, so there is no article page to read.

import { USER_AGENT } from './sources.mjs';

const PAGE_TIMEOUT_MS = 9_000;
const CONCURRENCY = 6;
const HTML_SCAN_BYTES = 200_000;

const META_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
];

/** The page is served over https, so an http image would be blocked as mixed
 *  content. Absolutise against the article URL and demand https. */
function normaliseImage(raw, baseUrl) {
  if (!raw) return '';
  let value = String(raw).trim().replace(/&amp;/g, '&');
  if (!value || value.startsWith('data:')) return '';
  try {
    const abs = new URL(value, baseUrl);
    if (abs.protocol === 'http:') abs.protocol = 'https:';
    if (abs.protocol !== 'https:') return '';
    return abs.href;
  } catch {
    return '';
  }
}

/** Pull an image out of the feed entry, without any extra request. */
export function imageFromEntry(entry, articleUrl) {
  const media = entry['media:content'] ?? entry.mediaContent;
  const list = Array.isArray(media) ? media : media ? [media] : [];
  for (const m of list) {
    const attrs = m?.$ ?? m;
    const type = attrs?.type || attrs?.medium || '';
    if (type && !/^image/i.test(type) && attrs?.medium !== 'image') continue;
    const found = normaliseImage(attrs?.url, articleUrl);
    if (found) return found;
  }

  const thumb = entry['media:thumbnail'] ?? entry.mediaThumb;
  const thumbUrl = normaliseImage((Array.isArray(thumb) ? thumb[0] : thumb)?.$?.url, articleUrl);
  if (thumbUrl) return thumbUrl;

  if (entry.enclosure && /^image/i.test(entry.enclosure.type || '')) {
    const enc = normaliseImage(entry.enclosure.url, articleUrl);
    if (enc) return enc;
  }

  const html = entry['content:encoded'] || entry.content || '';
  const inline = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return inline ? normaliseImage(inline[1], articleUrl) : '';
}

/** Read og:image off the article page. Resolves '' on any failure. */
export async function imageFromPage(url) {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)news\.google\.com$/.test(host)) return '';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return '';
    const html = (await res.text()).slice(0, HTML_SCAN_BYTES);
    for (const re of META_PATTERNS) {
      const m = re.exec(html);
      const found = normaliseImage(m?.[1], res.url || url);
      if (found) return found;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Fills `image` on the items that lack one, by fetching their article page.
 * Bounded: at most `limit` requests, `CONCURRENCY` at a time. Returns how many
 * images were found. Mutates the items in place.
 */
export async function backfillImages(items, { limit = 40, log = console } = {}) {
  const targets = items
    .filter((i) => !i.image && i.url && !/news\.google\.com/.test(i.url))
    .slice(0, limit);
  if (!targets.length) return 0;

  let found = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const item = targets[cursor++];
      const image = await imageFromPage(item.url);
      if (image) {
        item.image = image;
        found += 1;
      }
    }
  });
  await Promise.all(workers);
  log.info?.(`  images: ${found} found across ${targets.length} pages checked`);
  return found;
}
