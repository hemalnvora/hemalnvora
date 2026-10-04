// Optional: keeps the hand-curated series (WRC, Dakar, TT, WEC, cricket, World Cups...) current by
// having Claude search the web and hand back the updated series through a tool call.
// Runs only when ANTHROPIC_API_KEY is set. One request loop per series, so one bad answer
// never wipes the others: anything that fails validation keeps the previous data.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.RESEARCH_MODEL || 'claude-opus-5';
const STATUSES = ['scheduled', 'done', 'cancelled', 'provisional'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const eventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stable id. Keep existing ids unchanged; new ids follow the same pattern.' },
    title: { type: 'string' },
    round: { type: 'integer' },
    place: { type: 'string', description: 'Venue and city/country' },
    start: { type: 'string', description: 'First day, YYYY-MM-DD, local to the venue' },
    end: { type: ['string', 'null'], description: 'Last day, YYYY-MM-DD, or null if not announced' },
    time: { type: 'string', description: 'Optional UTC ISO time of the headline session, e.g. 2026-10-04T07:00:00Z. Only when confirmed.' },
    timeLabel: { type: 'string', description: 'What `time` refers to: Race, Start, Day 1, Final...' },
    status: { type: 'string', enum: STATUSES },
    result: { type: 'string', description: 'For done events: winner or scoreline' },
    note: { type: 'string' },
    hot: { type: 'boolean', description: 'True only for genuinely hyped events: title deciders, marquee fixtures, finals' },
    link: { type: 'string' },
    winner: { type: 'string', description: 'Done events: the winning driver, rider, crew or team ("Draw" / "No result" for cricket)' },
    podium: {
      type: 'array',
      description: 'Done races and rallies: top three finishers',
      items: { type: 'object', properties: { pos: { type: 'integer' }, name: { type: 'string' }, team: { type: 'string' }, detail: { type: 'string', description: 'Time or gap' } }, required: ['pos', 'name'] },
    },
    scores: {
      type: 'array',
      description: 'Done matches: one entry per team or innings in batting order, e.g. {team: "India", score: "406/2 (43.3 ov)"}',
      items: { type: 'object', properties: { team: { type: 'string' }, score: { type: 'string' } }, required: ['team', 'score'] },
    },
    highlights: { type: 'array', items: { type: 'string' }, description: 'Done events: 1–4 short facts (top scorer, best bowling, player of the match, pole...)' },
    teams: { type: 'array', items: { type: 'string' }, description: 'Cricket matches: the two teams, using ICC team names' },
    format: { type: 'string', enum: ['Test', 'ODI', 'T20I'], description: 'Cricket matches only' },
    home: { type: 'string', description: 'Cricket matches: the home team, omitted at neutral venues' },
    gender: { type: 'string', enum: ['women'], description: "Set only for women's matches" },
    prediction: {
      type: 'object',
      description: 'Only for scheduled events with published bookmaker odds: implied probabilities normalised to 100',
      properties: {
        method: { type: 'string', enum: ['odds'] },
        label: { type: 'string', description: 'e.g. "Bookmaker odds (Oddschecker, 3 Oct), normalised"' },
        asOf: { type: 'string' },
        picks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pct: { type: 'number' } }, required: ['name', 'pct'] } },
        other: { type: 'number' },
        source: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['url'] },
      },
      required: ['method', 'label', 'picks', 'source'],
    },
  },
  required: ['id', 'title', 'place', 'start', 'end', 'status'],
};

const submitSeriesTool = {
  name: 'submit_series',
  description: 'Submit the complete, updated series. Call exactly once, after researching.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One or two plain sentences on the state of play right now' },
      standings: {
        type: ['object', 'null'],
        properties: {
          title: { type: 'string' },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: { pos: { type: 'integer' }, name: { type: 'string' }, team: { type: 'string' }, pts: { type: ['number', 'null'] } },
              required: ['pos', 'name'],
            },
          },
        },
      },
      events: { type: 'array', items: eventSchema },
      sources: { type: 'array', items: { type: 'string' }, description: 'URLs you relied on' },
    },
    required: ['summary', 'events'],
  },
};

const submitBuzzTool = {
  name: 'submit_buzz',
  description: 'Submit the headline list. Call exactly once, after researching.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            series: { type: 'string', description: 'One of the series ids given in the prompt' },
            title: { type: 'string' },
            summary: { type: 'string' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            hot: { type: 'boolean' },
            link: { type: 'string' },
          },
          required: ['series', 'title', 'summary', 'date', 'link'],
        },
      },
    },
    required: ['items'],
  },
};

// After a mid-output fallback, blocks before the last `fallback` marker that the fallback model
// can't continue from must not be echoed back (see the refusal-fallback docs).
function sanitizeForEcho(content) {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  if (lastFallback < 0) return content;
  const resultIds = new Set(content.filter((b) => b.tool_use_id).map((b) => b.tool_use_id));
  return content.filter((b, i) => {
    if (i >= lastFallback) return true;
    if (['thinking', 'redacted_thinking', 'tool_use'].includes(b.type)) return false;
    if (b.type === 'server_tool_use' && !resultIds.has(b.id)) return false;
    return true;
  });
}

async function runToSubmission(client, { system, prompt, tool, maxSearches = 12, log }) {
  const messages = [{ role: 'user', content: prompt }];
  for (let turn = 0; turn < 8; turn++) {
    const msg = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }, tool],
        messages,
      })
      .finalMessage();

    if (msg.stop_reason === 'refusal') throw new Error(`declined (${msg.stop_details?.category ?? 'no category'})`);
    const call = msg.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (call) return call.input;

    messages.push({ role: 'assistant', content: sanitizeForEcho(msg.content) });
    if (msg.stop_reason === 'pause_turn') continue; // server-side search loop paused; resume it
    log?.(`turn ${turn}: stopped with ${msg.stop_reason} without submitting; nudging`);
    messages.push({ role: 'user', content: `Call ${tool.name} now with the complete result.` });
  }
  throw new Error('no submission after 8 turns');
}

function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !e.id || !e.title || !DATE.test(e.start || '')) return null;
  const out = {
    id: String(e.id),
    title: String(e.title),
    place: String(e.place || ''),
    start: e.start,
    end: DATE.test(e.end || '') ? e.end : null,
    status: STATUSES.includes(e.status) ? e.status : 'scheduled',
  };
  if (Number.isInteger(e.round)) out.round = e.round;
  if (e.time && !Number.isNaN(Date.parse(e.time))) {
    out.time = new Date(e.time).toISOString().replace('.000Z', 'Z');
    out.timeLabel = String(e.timeLabel || 'Start');
  }
  for (const k of ['result', 'note', 'link', 'winner', 'home']) if (e[k]) out[k] = String(e[k]);
  if (e.hot === true) out.hot = true;
  if (['Test', 'ODI', 'T20I'].includes(e.format)) out.format = e.format;
  if (e.gender === 'women') out.gender = 'women';
  if (Array.isArray(e.teams) && e.teams.length === 2) out.teams = e.teams.map(String);
  if (Array.isArray(e.highlights)) out.highlights = e.highlights.filter((x) => typeof x === 'string' && x).slice(0, 4);
  if (out.status === 'done') {
    if (Array.isArray(e.podium)) out.podium = e.podium.filter((x) => x?.name && Number.isInteger(x.pos)).slice(0, 3);
    if (Array.isArray(e.scores)) out.scores = e.scores.filter((x) => x?.team && x?.score).slice(0, 4);
  } else {
    delete out.winner;
  }
  // Keep a pre-event prediction once the event is done; accept new ones only from published odds.
  const p = e.prediction;
  if (p && Array.isArray(p.picks) && p.picks.length && p.label && (p.method === 'odds' ? Boolean(p.source?.url) : out.status === 'done')) out.prediction = p;
  return out;
}

export function mergeResearchedSeries(prev, input) {
  const events = (input?.events || []).map(cleanEvent).filter(Boolean);
  // Guard against a truncated or confused answer: it must keep most of what we already had.
  const prevIds = new Set(prev.events.map((e) => e.id));
  const kept = events.filter((e) => prevIds.has(e.id)).length;
  if (!events.length || (prev.events.length >= 4 && kept < prev.events.length * 0.6)) {
    throw new Error(`rejected: ${events.length} events, only ${kept}/${prev.events.length} existing ids kept`);
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return {
    ...prev,
    summary: typeof input.summary === 'string' && input.summary ? input.summary : prev.summary,
    standings: input.standings === undefined ? prev.standings : input.standings,
    events,
    researchedAt: new Date().toISOString(),
    ...(Array.isArray(input.sources) && input.sources.length ? { sources: input.sources.slice(0, 8) } : {}),
  };
}

const SYSTEM = [
  'You maintain a personal sports schedule board for a fan in India who follows motorsport and cricket.',
  'Use web search to verify every date against official or reputable sources (series websites, governing bodies, ESPNcricinfo, Wikipedia season pages, major outlets).',
  'Never invent dates, times, venues or results. If something is not announced, leave it out or use null for an unknown end date.',
  'Keep existing event ids exactly as given so the board can track them.',
].join(' ');

export async function researchAll({ curatedSeries, buzz, today = new Date(), log = console.log }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  const client = new Anthropic();
  const day = today.toISOString().slice(0, 10);
  const series = [];

  for (const prev of curatedSeries) {
    try {
      const prompt = [
        `Today is ${day}. Update the "${prev.name}" (${prev.code}) section of the board.`,
        '',
        'Current data (JSON):',
        JSON.stringify({ summary: prev.summary, standings: prev.standings, events: prev.events }, null, 1),
        '',
        'Do this:',
        '1. Mark events that have finished as "done" and add the winner or result in `result`.',
        '2. Correct any date, venue or status that has changed; mark cancelled events "cancelled" with a short note.',
        '3. Add newly announced events for roughly the next 15 months (for cricket: India fixtures match by match when published, other tours as one row per series).',
        '4. Refresh `summary` and `standings` (top 5; standings may be null where there is no championship).',
        '5. Set `hot: true` only on the few events people are most excited about right now.',
        '6. For finished events fill `winner`, and `podium` (races, rallies) or `scores` (matches) plus up to 4 `highlights`.',
        '7. For cricket matches keep `teams`, `format`, `home` and `gender`. Keep any existing `prediction` unchanged; add one to a scheduled event only from published bookmaker odds, converted to implied probabilities and normalised to 100, with its source.',
        'Then call submit_series with the complete event list (keep past events from this season too).',
      ].join('\n');
      const input = await runToSubmission(client, { system: SYSTEM, prompt, tool: submitSeriesTool, log });
      series.push(mergeResearchedSeries(prev, input));
      log(`[research] ${prev.id}: ok`);
    } catch (err) {
      log(`[research] ${prev.id}: kept previous data (${err.message})`);
      series.push(prev);
    }
  }

  let newBuzz = buzz;
  try {
    const ids = ['f1', 'motogp', ...curatedSeries.map((s) => s.id)];
    const prompt = [
      `Today is ${day}. Find the 8 to 10 most talked-about stories of the past 7 days across:`,
      'Formula 1, MotoGP, WRC and rally-raid (Dakar), Isle of Man TT and road racing, WEC / Le Mans and 24-hour racing,',
      'Indian and international cricket, and any World Cup (football, cricket, rugby) news.',
      `Tag each with one series id from: ${ids.join(', ')}.`,
      'Each summary is one or two plain sentences with the key numbers. Prefer title fights, schedule changes, big results and announcements.',
      'Call submit_buzz with the list, most important first.',
    ].join('\n');
    const input = await runToSubmission(client, { system: SYSTEM, prompt, tool: submitBuzzTool, maxSearches: 15, log });
    const items = (input.items || []).filter((x) => x.title && x.summary && ids.includes(x.series)).slice(0, 10);
    if (items.length >= 4) newBuzz = { updatedAt: new Date().toISOString(), items };
    log(`[research] buzz: ${items.length} items`);
  } catch (err) {
    log(`[research] buzz: kept previous (${err.message})`);
  }

  return { series, buzz: newBuzz, researchedAt: new Date().toISOString() };
}
