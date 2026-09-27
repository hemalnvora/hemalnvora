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
| Formula 1 | [Jolpica F1 API](https://github.com/jolpica/jolpica-f1) (successor to Ergast) | Live: calendar, session times, winners, standings |
| MotoGP | The public API behind motogp.com | Live: calendar, session times, winners, standings, next season |
| WRC, Dakar, W2RC, Isle of Man TT, WEC & Le Mans, 24h classics, cricket, World Cups | `data/curated.json`, checked against official sites | Daily web research by Claude (hosted: the routine; self-hosted: optional, needs `ANTHROPIC_API_KEY`) |

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
node scripts/validate.mjs data/latest.json   # schema check (also used by the daily routine)
```

To correct something by hand, edit `data/curated.json` and bump its `curatedAt`. A newer
`curatedAt` wins over an older research run.

```
src/server.mjs        HTTP server + refresh timer
src/refresh.mjs       builds data/latest.json from the feeds and the curated or researched series
src/research.mjs      Claude + web search research, one validated update per series
src/sources/          F1 (Jolpica) and MotoGP feed adapters
web/index.html        the page (same file for the hosted and self-hosted versions)
data/curated.json     hand-checked series, F1 next-season fallback, headlines
scripts/              feeds.mjs, validate.mjs, build-artifact.mjs, kit.mjs
deploy/               systemd unit, Caddyfile
docs/daily-refresh.md the prompt the hosted board's daily routine runs
```
