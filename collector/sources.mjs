// Source list for the Urban Lab News Radar collector.
//
// Two kinds of source:
//   rss    — the outlet's own feed. Ships a real article snippet, so summaries are good.
//   gnews  — a Google News search feed. Great for discovery and the only way to reach
//            outlets that block automated access, but it returns the headline only and
//            links through a Google redirect (the publisher URL is not recoverable).

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const AREAS = [
  'Culture Led Development',
  'Public Private Development',
  'Housing Affordability',
  'Net Zero Cities',
];

// Full text sits behind a subscription: the summary is recorded as "(paywall)".
export const PAYWALLED_HOSTS = new Set([
  'nytimes.com', 'wsj.com', 'economist.com', 'bloomberg.com', 'ft.com',
  'crainsnewyork.com', 'crainschicagobusiness.com', 'crainsdetroit.com',
  'therealdeal.com', 'costar.com', 'globest.com', 'bisnow.com/studio-b',
]);

// nytimes.com, wsj.com, reuters.com and economist.com block automated access
// outright, so they are unreachable by direct feed or fetch. Google News still
// indexes them, which is what the "priority-blocked" query below is for.
const gnews = (query) =>
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent(query) +
  '&hl=en-US&gl=US&ceid=US:en';

const RECENT = 'when:3d';

export const SOURCES = [
  // ---- outlet feeds (rich snippets) ----
  { id: 'commercial-observer', name: 'Commercial Observer', kind: 'rss', cap: 25,
    url: 'https://commercialobserver.com/feed/' },
  { id: 'bisnow', name: 'Bisnow', kind: 'rss', cap: 25,
    url: 'https://www.bisnow.com/rss' },
  { id: 'route-fifty', name: 'Route Fifty', kind: 'rss', cap: 25,
    url: 'https://www.route-fifty.com/rss/all/' },
  { id: 'smart-cities-dive', name: 'Smart Cities Dive', kind: 'rss', cap: 25,
    url: 'https://www.smartcitiesdive.com/feeds/news/' },
  { id: 'construction-dive', name: 'Construction Dive', kind: 'rss', cap: 25,
    url: 'https://www.constructiondive.com/feeds/news/' },

  // ---- discovery by research area ----
  { id: 'gn-public-private', name: 'Google News', kind: 'gnews', cap: 20,
    url: gnews(`${RECENT} ("public-private partnership" OR "ground lease" OR "joint development" OR "development agreement" OR "request for proposals") (city OR county OR state OR agency OR authority) developer`) },
  { id: 'gn-housing', name: 'Google News', kind: 'gnews', cap: 20,
    url: gnews(`${RECENT} ("housing affordability" OR "zoning reform" OR "affordable housing" OR "upzoning" OR "rent stabilization") (city OR county OR state OR council OR legislature)`) },
  { id: 'gn-culture', name: 'Google News', kind: 'gnews', cap: 20,
    url: gnews(`${RECENT} ("arts district" OR "cultural district" OR "creative placemaking" OR "performing arts center" OR museum) (development OR redevelopment OR groundbreaking) city`) },
  { id: 'gn-netzero', name: 'Google News', kind: 'gnews', cap: 20,
    url: gnews(`${RECENT} ("building performance standard" OR "Local Law 97" OR "building decarbonization" OR "net zero" OR "embodied carbon") (buildings OR city OR retrofit)`) },

  // ---- priority outlets the Lab asked for ----
  { id: 'gn-priority-blocked', name: 'Google News', kind: 'gnews', cap: 20,
    url: gnews(`${RECENT} (site:nytimes.com OR site:wsj.com OR site:reuters.com OR site:economist.com) (housing OR zoning OR "public-private" OR "net zero" OR "real estate development" OR "arts district")`) },
  { id: 'gn-priority-trade', name: 'Google News', kind: 'gnews', cap: 20,
    url: gnews(`${RECENT} (site:urbanland.uli.org OR site:uli.org OR site:crainsnewyork.com OR site:therealdeal.com OR site:planetizen.com OR site:forbes.com OR site:bloomberg.com) (housing OR zoning OR "public-private" OR "net zero" OR "arts district" OR development)`) },
];

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isPaywalled(url) {
  const host = hostOf(url);
  if (!host) return false;
  for (const p of PAYWALLED_HOSTS) {
    if (host === p || host.endsWith('.' + p) || (url || '').includes(p)) return true;
  }
  return false;
}
