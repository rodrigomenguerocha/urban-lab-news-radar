# Urban Lab News Radar

Daily press monitoring for the [NYU Urban Lab](https://urbanlab.nyu.edu/) (Schack Institute
of Real Estate). A scheduled job reads news feeds, screens them with the Anthropic API, and
publishes a filterable list of articles — source, publication date, link and a short summary —
filed under the Lab's four research areas.

**Live page:** https://rodrigomenguerocha.github.io/urban-lab-news-radar/

```
 feeds (RSS + Google News)
        │
        ├─ dedupe against site/data/articles.json
        │
        ├─ Anthropic API — screen, tag, summarise        collector/classify.mjs
        │
        ├─ commit site/data/articles.json                (history lives in git)
        │
        └─ deploy site/ to GitHub Pages                  .github/workflows/collect.yml
```

## Research areas

Every article is filed under exactly one:

| Area | Scope |
|---|---|
| **Culture Led Development** | cultural and arts districts, museums and performing arts centres as development anchors, creative placemaking, public art in projects |
| **Public Private Development** | a public body and a private developer in a real estate deal: development agreements, land conveyance, ground leases, joint development, air rights, project RFPs and RFQs |
| **Housing Affordability** | zoning and code reform, affordable housing finance and production, rent policy, federal and state housing legislation, affordability research |
| **Net Zero Cities** | building performance standards, Local Law 97 and equivalents, retrofits, operational and embodied carbon, municipal climate policy affecting real estate |

## Setup

The repository is ready to run; two things need doing once, in the GitHub UI or CLI.

**1. Add the API key** as a repository secret named `ANTHROPIC_API_KEY`:

```bash
gh secret set ANTHROPIC_API_KEY --repo rodrigomenguerocha/urban-lab-news-radar
```

Get the key at <https://console.anthropic.com/settings/keys>. It is only ever read by the
Actions runner — it never reaches the browser, because the published page is static and
contains no API call.

**2. Confirm Pages is serving from Actions** — Settings → Pages → Build and deployment →
Source: *GitHub Actions*. The included workflow deploys there on every run.

Optionally set a repository variable `ANTHROPIC_MODEL` to override the default model.

## Running it

The daily run fires at 11:40 UTC (07:40 New York in summer, 06:40 in winter — GitHub cron
has no timezone, and Actions can start a scheduled run late). To run it now, or to test
without spending anything, use **Actions → Collect and publish → Run workflow**, which takes
a `limit` and a `dry_run` toggle.

Locally:

```bash
npm install
npm run collect:dry                  # read feeds, list candidates, no API call
ANTHROPIC_API_KEY=sk-ant-... npm run collect
npm run serve                        # preview site/ at http://localhost:8080
```

## Sources

`collector/sources.mjs` holds the whole list. Two kinds:

- **Outlet feeds** — Commercial Observer, Bisnow, Route Fifty, Smart Cities Dive,
  Construction Dive. These ship real article text, so their summaries are the good ones.
- **Google News search feeds** — four queries, one per research area, plus two that target
  the outlets the Lab asked for. These are for discovery: they return the headline only and
  link through a Google redirect, so items found this way usually have a blank summary.

**Four requested outlets cannot be read at all: The New York Times, The Wall Street Journal,
Reuters and The Economist block automated access.** Not a paywall — a refusal. They are
reachable only through the Google News query, which yields headline, outlet, date and link.
Their summaries stay blank or `(paywall)`.

Paywalled hosts are listed in `PAYWALLED_HOSTS`; anything from them gets the summary
`(paywall)` rather than a guess. To add a source, append to `SOURCES` — an outlet feed if
the site publishes one that permits automated reading, otherwise a Google News query.

## Cost

One API call per batch of 12 candidates, capped at 60 candidates per run — about five calls
a day on `claude-sonnet-5`. The run prints its token usage, and each run's summary appears
in the Actions job summary. Levers, cheapest first: the per-run `limit`, the source caps in
`sources.mjs`, and the model.

## Data

`site/data/articles.json` is the whole dataset, committed on every run so the list has a git
history:

```json
{
  "updated": "2026-09-10",
  "model": "claude-sonnet-5",
  "count": 53,
  "items": [
    {
      "id": "asheville-zoning",
      "title": "Asheville council approves zoning changes to expand housing options",
      "source": "WLOS",
      "url": "https://wlos.com/news/local/...",
      "date": "2026-08-28",
      "summary": "Asheville's council approved changes allowing duplexes and accessory dwelling units more widely...",
      "tag": "Housing Affordability",
      "found": "2026-09-10"
    }
  ]
}
```

`date` is the publication date taken from the feed — `YYYY-MM-DD`, or `YYYY-MM` when only the
month is certain, or empty. The model is never asked to supply it, so no date is invented.
`found` is the day the collector picked the article up, and the page groups by it.

Reading and starred marks are per-browser (`localStorage`); they are not part of the dataset.

## Known limits

- **Headline-only items.** Anything found through Google News arrives without article text,
  so its summary is blank. Fixing this means fetching the publisher page, which the Google
  redirect does not permit — the real article URL is not recoverable from it.
- **One tag per article.** A piece spanning two areas is filed under its main news hook.
- **No cross-source dedupe.** The same story from three outlets is three rows; they are
  deduplicated by URL, not by story.
- **Old entries are pruned** after 400 days.

## Layout

```
collector/sources.mjs    feed list, research areas, paywalled hosts
collector/feeds.mjs      fetch and parse, hard timeout, one dead feed never stops a run
collector/classify.mjs   the Anthropic call: structured outputs via zod
collector/collect.mjs    orchestration, dedupe, merge, write
site/index.html          the page, no build step, no dependencies
site/data/articles.json  the dataset
scripts/serve.mjs        local preview server
legacy/                  an earlier Python prototype, superseded by collector/
```
