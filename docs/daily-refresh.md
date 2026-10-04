# Daily refresh of the hosted board

The hosted board at https://claude.ai/artifact/97HjR5EBb3X6Ya15dkEoyx reads all of its data from the
artifact's database. A Claude Code routine runs every morning at 06:10 IST in a fresh cloud session
and brings that database up to date. This is the prompt it runs, kept here so changes are tracked.
The helper it downloads, `tools/board-kit.mjs`, is `npm run build:kit` output (from `scripts/kit.mjs`),
published next to the page so the routine doesn't need this repository. It fetches the F1/MotoGP
feeds (results, podiums, win and title chances), prices cricket matches from ICC ratings, and
validates every document before it is written.

---

You are refreshing "Paddock & Pavilion", a personal sports schedule board published as a claude.ai
artifact: https://claude.ai/artifact/97HjR5EBb3X6Ya15dkEoyx. The page renders whatever is in the
artifact's database, so your job is to bring that database up to date. Do not republish the page,
do not commit or push to the repository, and do not open pull requests. Finish every step; if one
part fails, carry on with the rest and say what failed in `changes`.

Database layout (use the ArtifactData tool; load it with ToolSearch if it is deferred):

- Collection `series`, one document per series. Document ids: `f1`, `motogp`, `wrc`, `dakar`, `w2rc`,
  `iomtt`, `wec`, `endurance`, `cricket-india`, `cricket-world`, `worldcups`.
  Shape: `{id, name, code, sport: "motorsport"|"cricket"|"worldcup", order, season, summary,
  standings: {title, rows: [{pos, name, team, pts, titlePct?}], titleNote?} | null, source: {label, url},
  updatedAt, events: [...]}`.
- Event: `{id, title, round?, place, start: "YYYY-MM-DD", end: "YYYY-MM-DD"|null, time?, timeLabel?,
  sessions?: [{name, time}], status: "scheduled"|"done"|"cancelled"|"provisional", note?, hot?, link?}`
  plus:
  - results, on done events only: `result` (one line), `winner` (driver, rider, crew or team; "Draw" or
    "No result" for cricket), `podium: [{pos, name, team?, detail?}]` for races and rallies (top three,
    detail = time or gap), `scores: [{team, score}]` for matches (batting order, e.g. "406/2 (43.3 ov)"),
    `highlights: [string]` (1–4 short facts: top scorer, best bowling, player of the match, pole...);
  - cricket matches: `teams: [team, team]` (ICC team names, host first), `format: "Test"|"ODI"|"T20I"`,
    `home` (the host team; leave it out at neutral venues), `gender: "women"` for women's matches;
  - `prediction: {method: "form"|"ratings"|"odds", label, asOf, picks: [{name, team?, pct}], other?,
    source?, backtest?, frozen?}`.
  `start`/`end` are venue-local dates. `time` is the UTC ISO time of the headline session and is only
  set when it is officially confirmed. Event ids are stable: never rename one.
- Collection `meta`: `buzz` = `{updatedAt, items: [{series, title, summary, date: "YYYY-MM-DD", hot, link}]}`;
  `status` = `{refreshedAt, runBy, note, changes}`; `cricket-ratings` = `{asOf, source, men: {Test, ODI,
  T20I}, women: {ODI, T20I}}`, each a map of ICC team name to ICC rating.

Timestamps: take every timestamp you write (`updatedAt`, `refreshedAt`, `asOf`) from
`date -u +%Y-%m-%dT%H:%M:%SZ` at the moment you write it. Never round or estimate one.

Steps:

1. Work in your scratchpad directory. Read the current state with ArtifactData `list` on `series` and on
   `meta`, passing `out_dir: "<scratch>/db"`, so each document lands at `<scratch>/db/<collection>/<id>.json`.
   Note each document's `version`. Copy the series files you will rewrite to `<scratch>/out/`.
2. Live feeds. Download the helper with the Artifact tool: `action: "read"`, the URL above,
   `path: "tools/board-kit.mjs"`. It saves the file locally and tells you where. Run
   `node <kit> feeds <scratch>/out --prev <scratch>/db/series`. That writes `f1.json` and `motogp.json`
   with results, podiums, win chances and title chances, keeping pre-race predictions of finished races.
   If a feed fails, keep that series' existing document unchanged.
3. Research the other nine series with WebSearch and WebFetch. Use official series sites (wrc.com,
   dakar.com, worldrallyraidchampionship.com, iomttraces.com, fiawec.com, imsa.com), ESPNcricinfo,
   ICC, FIFA, World Rugby, Wikipedia season pages and major outlets. For each series:
   - mark finished events `done` and fill `result`, `winner`, and `podium` or `scores`, plus a few
     `highlights`. Do this for every done event of the last 30 days that is still missing them;
   - correct changed dates and venues, and mark cancelled events `cancelled` with a short `note`;
   - add newly announced events for roughly the next 15 months. For cricket-india, list India fixtures
     (men's and women's) match by match once they are published. For cricket-world, use one row per
     tour or tournament, except marquee matches, which get their own rows. Give every cricket match
     row `teams`, `format`, `home` and `gender` as described above;
   - refresh `summary` (one or two plain sentences) and `standings` (top 5, or null where there is no
     championship);
   - set `hot: true` only on the handful of events people are most excited about right now;
   - set `updatedAt` to the current time; keep past events of the current season.
   Never invent dates, times, venues, results or numbers. If something is not confirmed, leave `time`
   out and use `end: null`.
4. Predictions. Never change or remove an existing `prediction` on an event that is now done: it is
   the record of what was expected beforehand. Cricket match predictions come from step 6, not from
   you. For other scheduled events (rallies, endurance races, the Dakar, the TT, World Cups, tournament
   winners) add `prediction` only from published bookmaker odds at a reputable source: convert each
   price to an implied probability (decimal odds d → 100/d), scale them so they add up to 100, list the
   top 3 to 5 in `picks` with the remainder in `other`, and set `method: "odds"`, a `label` naming the
   bookmaker and date, `asOf`, and `source: {label, url}`. If you cannot find odds, leave it out.
5. Cricket ratings. If `meta/cricket-ratings` is more than 7 days old, look up the current ICC team
   rankings (men's Test, ODI, T20I; women's ODI, T20I) and update the ratings and `asOf`. Copy the
   ratings document to `<scratch>/out/cricket-ratings.json` either way.
6. Run `node <kit> predict <scratch>/out --ratings <scratch>/out/cricket-ratings.json`. It prices every
   upcoming cricket match that has `teams` and `format`, and lists any it could not price.
7. Buzz: find the 8 to 10 most talked-about stories of the last 7 days across these sports (title
   fights, big results, calendar announcements, World Cup news). Give each a one-or-two-sentence
   summary with the key numbers, a link, and one series id from the list above. Most important first.
   Write it to `<scratch>/out/buzz.json` with `updatedAt` set to now.
8. Validate with `node <kit> validate <scratch>/out` and fix anything it reports.
9. Write everything back in one ArtifactData `batch` of `set` operations (one `file_path` per
   document; series in `series`, `buzz`, `status` and `cricket-ratings` in `meta`), pinning each write
   with the `if_version` you read in step 1. Include `meta/status` with `refreshedAt` (now), `runBy:
   "daily refresh"`, `note` copied unchanged from the current status document, and `changes`: one
   sentence on what this run actually changed. If a pinned write conflicts, re-read that document,
   redo your change on top of it, and write again.
10. End with a short summary of what changed (new events, results, corrections), or say briefly that
   nothing notable changed.
