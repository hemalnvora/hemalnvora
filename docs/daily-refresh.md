# Daily refresh of the hosted board

The hosted board at https://claude.ai/artifact/97HjR5EBb3X6Ya15dkEoyx reads all of its data from the
artifact's database. A Claude Code routine runs every morning at 06:10 IST in a fresh cloud session
and brings that database up to date. This is the prompt it runs, kept here so changes are tracked.
The helper it downloads, `tools/board-kit.mjs`, is `npm run build:kit` output (from `scripts/kit.mjs`),
published next to the page so the routine doesn't need this repository.

---

You are refreshing "Paddock & Pavilion", a personal sports schedule board published as a claude.ai
artifact: https://claude.ai/artifact/97HjR5EBb3X6Ya15dkEoyx. The page renders whatever is in the
artifact's database, so your job is to bring that database up to date. Do not republish the page,
do not commit or push to the repository, and do not open pull requests.

Database layout (use the ArtifactData tool; load it with ToolSearch if it is deferred):

- Collection `series`, one document per series. Document ids: `f1`, `motogp`, `wrc`, `dakar`, `w2rc`,
  `iomtt`, `wec`, `endurance`, `cricket-india`, `cricket-world`, `worldcups`.
  Shape: `{id, name, code, sport: "motorsport"|"cricket"|"worldcup", order, season, summary,
  standings: {title, rows: [{pos, name, team, pts}]} | null, source: {label, url}, updatedAt, events: [...]}`.
  Event: `{id, title, round?, place, start: "YYYY-MM-DD", end: "YYYY-MM-DD"|null, time?, timeLabel?,
  sessions?: [{name, time}], status: "scheduled"|"done"|"cancelled"|"provisional", result?, note?, hot?, link?}`.
  `start`/`end` are venue-local dates. `time` is the UTC ISO time of the headline session and is only
  set when it is officially confirmed. Event ids are stable: never rename one.
- Collection `meta`: document `buzz` = `{updatedAt, items: [{series, title, summary, date: "YYYY-MM-DD", hot, link}]}`;
  document `status` = `{refreshedAt, runBy, note, changes}`.

Steps:

1. Work in your scratchpad directory. Read the current state with ArtifactData `list` on `series` and on
   `meta`, passing `out_dir` so each document lands as a JSON file. Note each document's `version`.
2. Live feeds. Download the board's helper script with the Artifact tool: `action: "read"`, the URL
   above, `path: "tools/board-kit.mjs"`. It saves the file locally and tells you where. Run
   `node <that file> feeds <scratch>/out`. That writes `f1.json` and `motogp.json` in the document shape
   above, including results and standings. If a feed fails, keep that series' existing document unchanged.
3. Research the other nine series with WebSearch and WebFetch. Use official series sites (wrc.com,
   dakar.com, worldrallyraidchampionship.com, iomttraces.com, fiawec.com, imsa.com), ESPNcricinfo,
   ICC, FIFA, World Rugby, Wikipedia season pages and major outlets. For each series:
   - mark finished events `done` and put the winner or result in `result`;
   - correct changed dates and venues, and mark cancelled events `cancelled` with a short `note`;
   - add newly announced events for roughly the next 15 months. For cricket-india, list India fixtures
     (men's and women's) match by match once they are published. For cricket-world, use one row per
     tour or tournament;
   - refresh `summary` (one or two plain sentences) and `standings` (top 5, or null where there is no
     championship);
   - set `hot: true` only on the handful of events people are most excited about right now;
   - set `updatedAt` to the current time; keep past events of the current season.
   Never invent dates, times, venues or results. If something is not confirmed, leave `time` out and
   use `end: null`.
4. Buzz: find the 8 to 10 most talked-about stories of the last 7 days across these sports (title
   fights, big results, calendar announcements, World Cup news). Give each a one-or-two-sentence
   summary with the key numbers, a link, and one series id from the list above. Most important first.
   Write it to `<scratch>/out/buzz.json` with `updatedAt` set to now.
5. Validate with `node <board-kit file> validate <scratch>/out` and fix anything it reports.
6. Write everything back in one ArtifactData `batch` of `set` operations (one `file_path` per
   document), pinning each write with the `if_version` you read in step 1. Include `meta/status` with
   `refreshedAt` (now, ISO), `runBy: "daily refresh"`, `note` copied unchanged from the current status
   document, and `changes`: one sentence on what changed today. If a pinned write conflicts, re-read
   that document, redo your change on top of it, and write again.
7. End with a short summary of what changed (new events, results, corrections), or say briefly that
   nothing notable changed.
