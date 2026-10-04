# Paddock & Pavilion

One board for the sport you follow: **F1, MotoGP, WRC, the Dakar and rally-raid, the Isle of Man TT,
Le Mans/WEC and the other 24-hour classics, Team India and world cricket, and World Cups**. Every time
is shown in your own time zone. It has countdowns, championship tables, a "Paddock talk" list of the
week's big stories, and a purple **Hot** tag on the events people are most excited about.

- **Hosted version (no server needed):** https://claude.ai/artifact/97HjR5EBb3X6Ya15dkEoyx
  A Claude Code routine refreshes it every morning at 06:10 IST. The routine's prompt is in
  [docs/daily-refresh.md](docs/daily-refresh.md).
- **Self-hosted version:** the same page, served by a small Node server that refreshes itself. See below.

## Where the data comes from

| Series | Source | How it stays current |
| --- | --- | --- |
| Formula 1 | [Jolpica F1 API](https://github.com/jolpica/jolpica-f1) (successor to Ergast) | Live: calendar, session times, full results, standings |
| MotoGP | The public API behind motogp.com | Live: calendar, session times, race and sprint results, standings, next season |
| WRC, Dakar, W2RC, Isle of Man TT, WEC & Le Mans, 24h classics, cricket, World Cups | `data/curated.json`, checked against official sites | Daily web research by Claude (hosted: the routine; self-hosted: optional, needs `ANTHROPIC_API_KEY`) |

## Results and win chances

Finished events carry their result: the podium with gaps, pole, fastest lap and sprint winner for F1
and MotoGP; scorecards, top performers and the margin for cricket; the winner and podium for rallies
and endurance races. The **Results** tab lists them newest first.

Upcoming events show win chances, worked out three ways:

- **F1 and MotoGP: a form model.** `src/predict.mjs` fits a Plackett–Luce model to this season's race
  and sprint finishing orders, with recent rounds weighted more, and reads each driver's chance of
  winning the next race from it. Title chances come from simulating the remaining rounds 20,000 times
  with the real points tables. The settings were chosen by backtesting on F1 2024–26 and MotoGP
  2025–26 (`node scripts/tune-model.mjs`): over 87 races the favourite was rated 33% on average and
  won 30% of the time.
- **Cricket: ICC ratings.** The ICC rating system expects a side rated *d* points higher to win about
  50 + *d* per cent of matches, capped at 90%. The board uses that rule, adds a home edge (Test 15,
  ODI 10, T20I 7 rating points) and keeps 15% for a draw in Tests. Ratings live in
  `data/curated.json` (`cricketRatings`) and in the hosted board's `meta/cricket-ratings` document.
- **Everything else: bookmaker odds**, when a reputable source publishes them. Prices are turned into
  implied chances, scaled to 100% and linked to their source. With no odds, no number is shown.

Each event keeps the prediction it had before it started, so the Results tab can show whether the
favourite won and how often favourites have won overall.

## Run it on a VPS

You need Docker, or Node 20+.

### Docker (recommended)

```bash
git clone https://github.com/hemalnvora/hemalnvora.git paddock-pavilion
cd paddock-pavilion
# optional, turns on daily web research for the non-API series:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up -d --build
```

The board is then on `http://<your-vps-ip>:8080`. Data lives in the `board-state` volume, so
restarts and rebuilds keep it.

### Without Docker (systemd)

```bash
sudo git clone https://github.com/hemalnvora/hemalnvora.git /opt/paddock-pavilion
cd /opt/paddock-pavilion && sudo npm ci --omit=dev
sudo cp deploy/paddock-pavilion.service /etc/systemd/system/
echo 'ANTHROPIC_API_KEY=sk-ant-...' | sudo tee /etc/paddock-pavilion.env   # optional
sudo systemctl daemon-reload && sudo systemctl enable --now paddock-pavilion
```

### HTTPS with your own domain

Point a DNS record at the VPS, put your domain in `deploy/Caddyfile`, and run Caddy in front:
`sudo apt install caddy && sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
Caddy fetches and renews the certificate on its own.

### Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on |
| `REFRESH_EVERY_HOURS` | `3` | How often the F1/MotoGP feeds are pulled and the board rebuilt |
| `RESEARCH_EVERY_HOURS` | `24` | How often Claude re-checks the other series (only with an API key) |
| `ANTHROPIC_API_KEY` | unset | Turns on web research. Without it, those series come from `data/curated.json` |
| `RESEARCH_MODEL` | `claude-opus-5` | Model used for the research |
| `DATA_DIR` | `./data` | Where `latest.json` and `researched.json` are written |

Web research makes one request loop per series plus one for the headlines, with up to 12 to 15 web
searches each. That is roughly a dozen requests a day. Raise `RESEARCH_EVERY_HOURS` if you want
it to run less often.

Endpoints: `/` is the board, `/data.json` is the raw data (the page re-reads it every 15 minutes), and
`/healthz` is a health check.

## Working on it

```bash
npm install
npm run refresh            # pull feeds, write data/latest.json
npm run research           # same, plus Claude web research (needs ANTHROPIC_API_KEY)
npm start                  # serve on :8080
npm run build:artifact     # dist/paddock-pavilion.html, the file published as the hosted board
npm run build:kit          # dist/board-kit.mjs, the one-file helper the daily routine downloads
node scripts/tune-model.mjs                  # backtest and re-tune the motorsport form model
node scripts/validate.mjs data/latest.json   # schema check (also used by the daily routine)
```

To correct something by hand, edit `data/curated.json` and bump its `curatedAt`. A newer
`curatedAt` wins over an older research run.

```
src/server.mjs        HTTP server + refresh timer
src/refresh.mjs       builds data/latest.json from the feeds and the curated or researched series
src/research.mjs      Claude + web search research, one validated update per series
src/sources/          F1 (Jolpica) and MotoGP feed adapters
src/predict.mjs       win and title chances (form model, ICC ratings)
web/index.html        the page (same file for the hosted and self-hosted versions)
data/curated.json     hand-checked series, F1 next-season fallback, headlines
scripts/              kit.mjs, validate.mjs, build-artifact.mjs, tune-model.mjs
deploy/               systemd unit, Caddyfile
docs/daily-refresh.md the prompt the hosted board's daily routine runs
```
