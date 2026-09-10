// A free keyword gate ahead of the API.
//
// Broad on purpose: a false positive costs one screening slot, a false negative
// loses a story. Its job is only to keep obvious noise — a recipe, a phone launch,
// a celebrity dress — from eating the per-run candidate budget, which matters now
// that broad section feeds are in the mix.

const PATTERNS = [
  // public-private development
  'public[-\\s]?private', '\\bP3s?\\b', '\\bPPPs?\\b', '\\bRFPs?\\b', '\\bRFQs?\\b',
  'request for (proposals?|qualifications?|information)', '\\bsolicitation\\b',
  'ground[-\\s]?lease', 'land lease', 'air rights', 'development agreement',
  'master developer', 'joint development', 'disposition and development',
  '(city|county|state|publicly)[-\\s]?owned', 'surplus (land|property|site)',
  'redevelopment (authority|agency|commission|plan|project)', 'land bank',
  'city council', 'city hall', '\\bmunicipal', 'housing authority',
  'transit (agency|authority|district)', 'port authority', 'school district',
  'tax increment', '\\bTIF\\b', 'eminent domain', 'community benefits',

  // housing affordability
  'affordab(le|ility)', '\\bzoning\\b', 'upzon', 'rezon', '\\bADUs?\\b',
  'accessory dwelling', 'housing (supply|crisis|shortage|policy|production|element)',
  '\\bLIHTC\\b', 'low[-\\s]income housing', 'rent (control|stabiliz|regulat|burden)',
  'inclusionary', 'missing middle', 'single[-\\s]family zoning', 'parking (minimum|requirement)',
  'homeless', 'workforce housing', 'starter home', 'permitting reform',
  'building code', 'housing act', 'section 8', 'housing voucher',

  // net zero cities
  'net[-\\s]?zero', 'decarboniz', 'building performance standard', '\\bBPS\\b',
  'local law 97', '\\bLL97\\b', 'embodied carbon', 'operational carbon',
  'emissions (limit|cap|reduction|standard|disclosure)', 'energy (retrofit|efficiency|code)',
  'electrif(y|ication)', 'heat pump', 'climate (plan|policy|mandate|law|ordinance)',
  'resilien(ce|t)', 'green building', 'solar', 'geothermal',

  // culture led development
  'arts district', 'cultural district', 'creative placemaking', 'placemaking',
  'performing arts', 'museum', 'cultural (institution|anchor|facility|plan)',
  'public art', 'music venue', 'theater (district|restoration)', 'artist (housing|space)',

  // shared vocabulary of the field
  'mixed[-\\s]?use', 'transit[-\\s]?oriented', '\\bTOD\\b', 'master plan',
  'downtown (plan|revitaliz|redevelop)', 'waterfront (plan|redevelop)',
  'adaptive reuse', 'office[-\\s]to[-\\s]residential', 'conversion',
];

const RE = new RegExp(PATTERNS.join('|'), 'i');

/** True when the article shows any sign of belonging to the Lab's four areas. */
export function looksRelevant(article) {
  return RE.test(`${article.title}\n${article.snippet || ''}`);
}

export function partition(articles) {
  const kept = [];
  const dropped = [];
  for (const a of articles) (looksRelevant(a) ? kept : dropped).push(a);
  return { kept, dropped };
}
