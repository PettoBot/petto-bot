// A benchmark, not a check (it is not in `npm run check`): the real REST client of discord.js with a fake network, and the request limit of Petto
// before (one line of 8 requests a second in the client, plus the count shared through Redis that waits and counts again each second) and after
// (utils/sharedRestLimit.js: a lane for the answers a person waits for and a lane for the background work). It prints how long a foreground request
// (the reply to a command, `!ping`) waits while the background sends many requests.
//   node scripts/bench-rest-limit.js [networkMs=40] [seconds=8]
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://u:p@localhost:5432/d';
const { REST } = require('@discordjs/rest');
const { performance } = require('node:perf_hooks');
const redis = require('../src/utils/redis');
const perf = require('../src/utils/perf');
const { attachSharedRestLimit } = require('../src/utils/sharedRestLimit');

const NETWORK_MS = Number(process.argv[2]) || 40;
const SECONDS = Number(process.argv[3]) || 8;
const PER_SECOND = 8;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeNetwork = async () => {
  await sleep(NETWORK_MS);
  return { status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}), text: async () => '{}', arrayBuffer: async () => new ArrayBuffer(0), body: null };
};

// The count that Petto shared through Redis (the same one in both stacks: in the new one it is counted but never waited for by an answer).
const counts = new Map();
const fakeRedis = {
  enabled: () => true,
  countThisSecond: async () => { await sleep(2); const second = Math.floor(Date.now() / 1000); counts.set(second, (counts.get(second) ?? 0) + 1); return counts.get(second); },
};

/** The limit as it was before this change (copied from the old utils/sharedRestLimit.js). */
function attachOld(rest, perSecond) {
  const original = rest.request.bind(rest);
  rest.request = async (options) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const used = await fakeRedis.countThisSecond('rest');
      if (used <= perSecond) break;
      await sleep(1_005 - (Date.now() % 1_000));
    }
    return original(options);
  };
}

function makeStack(kind, withRedis) {
  counts.clear();
  const rest = new REST({ globalRequestsPerSecond: kind === 'old' ? PER_SECOND : PER_SECOND * 4, makeRequest: fakeNetwork, timeout: 60_000 });
  rest.setToken('x');
  const saved = { enabled: redis.enabled, count: redis.countThisSecond };
  redis.enabled = () => withRedis;
  redis.countThisSecond = fakeRedis.countThisSecond;
  if (kind === 'old') { if (withRedis) attachOld(rest, PER_SECOND); } else attachSharedRestLimit(rest, PER_SECOND);
  return { rest, restore: () => { redis.enabled = saved.enabled; redis.countThisSecond = saved.count; } };
}

const percentile = (values, fraction) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] : 0; };
let channel = 1000000000000000;
const nextChannel = () => `${(channel += 1)}`;

/** Foreground: a reply to a command, inside an interactive context as the event handler gives it. */
function foreground(rest) {
  const context = perf.newContext({ kind: 'event', name: 'interactionCreate', interactive: true });
  const started = performance.now();
  return perf.runWith(context, () => rest.post(`/channels/${nextChannel()}/messages`, { body: { content: 'x' } })).then(() => performance.now() - started);
}

async function scenario(title, kind, withRedis, background) {
  const { rest, restore } = makeStack(kind, withRedis);
  const waits = [];
  const stop = Date.now() + SECONDS * 1000;
  const pending = [];
  const feed = (async () => {
    // `background`: { burst: n requests at the start, rate: requests a second sustained }
    for (let i = 0; i < (background.burst ?? 0); i += 1) pending.push(rest.post(`/channels/${nextChannel()}/messages`, { body: { content: 'bg' } }).catch(() => {}));
    if (background.rate) {
      while (Date.now() < stop) {
        for (let i = 0; i < background.rate / 10; i += 1) pending.push(rest.post(`/channels/${nextChannel()}/messages`, { body: { content: 'bg' } }).catch(() => {}));
        await sleep(100);
      }
    }
  })();
  await sleep(150);
  while (Date.now() < stop) { waits.push(await foreground(rest)); await sleep(700); }
  await feed;
  restore();
  return { title, p50: percentile(waits, 0.5), p95: percentile(waits, 0.95), max: Math.max(...waits), count: waits.length, backlog: pending.length };
}

(async () => {
  const rows = [];
  const cases = [
    ['quiet (no background)', {}],
    ['burst of 60 background requests', { burst: 60 }],
    ['burst of 200 background requests', { burst: 200 }],
    ['sustained 12 req/s background', { rate: 12 }],
  ];
  for (const [name, background] of cases) {
    rows.push(await scenario(`${name} | before, Redis on`, 'old', true, background));
    rows.push(await scenario(`${name} | before, no Redis`, 'old', false, background));
    rows.push(await scenario(`${name} | after`, 'new', true, background));
  }
  console.log(`Foreground request (a reply to a command) with ${NETWORK_MS} ms of network, ${PER_SECOND} requests a second allowed, ${SECONDS} s per case:`);
  console.log('case'.padEnd(66), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'max ms'.padStart(8));
  for (const row of rows) console.log(row.title.padEnd(66), String(Math.round(row.p50)).padStart(8), String(Math.round(row.p95)).padStart(8), String(Math.round(row.max)).padStart(8));
  process.exit(0);
})();
