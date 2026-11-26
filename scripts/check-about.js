// /about (src/commands/utility/about.ts): the card has the bot (version, servers and members of the whole bot, shards and clusters), the server where it was used (with the shard and the
// instance that look after it), the hosting and credits (CubePath and Discloud, with links) and five link buttons, in the three languages. A fake Discord and a fake database: nothing real.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = 'postgres://u:p@127.0.0.1:1/d';
process.env.DISCORD_SHARDS = '0,5'; // this process holds two of the six shards
process.env.DISCORD_SHARD_COUNT = '6';
const root = path.join(__dirname, '..');
const resolve = (file) => require.resolve(path.join(root, file));
const fake = (file, exports) => { require.cache[resolve(file)] = { id: resolve(file), filename: resolve(file), loaded: true, exports }; };

const fresh = () => new Date().toISOString();
const STATUS = [
  { shard_id: 0, status: 'Ready', updated_at: fresh(), cluster_name: 'Discloud', cluster_location: null },
  { shard_id: 1, status: 'Ready', updated_at: fresh(), cluster_name: 'Miami', cluster_location: 'Florida, US' },
  { shard_id: 2, status: 'Ready', updated_at: fresh(), cluster_name: 'Miami', cluster_location: 'Florida, US' },
  { shard_id: 3, status: 'Ready', updated_at: fresh(), cluster_name: 'Virginia', cluster_location: 'Virginia, US' },
  { shard_id: 4, status: 'Ready', updated_at: fresh(), cluster_name: 'Virginia', cluster_location: 'Virginia, US' },
  { shard_id: 5, status: 'Ready', updated_at: fresh(), cluster_name: 'Discloud', cluster_location: null },
];
let failing = false;
fake('src/db/postgres.js', { getPrimaryPool: () => ({ query: async (sql, params) => {
  if (failing) throw new Error('database down');
  // The totals: the one server this process holds on its own shards (shard 1, 1,234 members) plus what the shards of the other instances report (1 to 4); the server of the card is on shard 4, which this process does not hold, so it is not counted here.
  if (/select shard_id, guild_count, member_count from bot_status/.test(sql)) return { rows: [0, 1, 2, 3, 4, 5].map((id) => ({ shard_id: id, guild_count: 70, member_count: id === 4 ? 15766 : 13000 })) }; // the code leaves out the shards of this process (0 and 5)
  if (/count\(\*\)::int as servers/.test(sql)) return { rows: [{ servers: 281, members: '56000' }] };
  if (/from bot_status/.test(sql)) return { rows: STATUS };
  throw new Error(`unexpected query: ${sql}`);
} }) });

const about = require('../src/commands/utility/about');
const botinfo = require('../src/commands/info/botinfo');

/** Every text and every link button of a card, in order. */
function readCard(payload) {
  const texts = []; const links = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.content === 'string') texts.push(node.content);
    if (node.type === 2 && node.url) links.push({ label: node.label, url: node.url });
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  };
  payload.components.forEach((component) => walk(component.toJSON()));
  return { text: texts.join('\n'), links };
}

const CREATED = Date.UTC(2020, 5, 15);
const guild = { id: '1414452131850879080', name: 'Petto Support', ownerId: '293504726505357312', memberCount: 1234, createdTimestamp: CREATED, shardId: 3,
  channels: { cache: new Map(Array.from({ length: 12 }, (_, index) => [index, {}])) }, roles: { cache: new Map(Array.from({ length: 7 }, (_, index) => [index, {}])) } };
const client = { uptime: 3 * 3600 * 1000, options: { shardCount: 6 }, user: { id: '999', username: 'Petto', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
  guilds: { cache: new Map([[guild.id, guild], ['777', { id: '777', shardId: 0, memberCount: 1234 }]]) }, ws: { shards: new Map([[0, { status: 0, ping: 20 }], [5, { status: 0, ping: 30 }]]) } };

(async () => {
  // ---- The command ----------------------------------------------------------------------------------------------------------------
  assert.equal(about.data.name, 'about'); assert.equal(about.registerSlash, true, 'a global slash command');
  assert.equal(about.data.toJSON().dm_permission, false, 'a server command, like the other global ones');
  assert.ok(!(botinfo.aliases ?? []).includes('about'), '!about is this command now, not an alias of !botinfo');
  assert.ok(about.data.toJSON().description.length <= 100);

  // ---- The card, in English -------------------------------------------------------------------------------------------------------
  const card = readCard(await about.buildAboutCard({ lang: 'en', client, guild }));
  const text = card.text;
  assert.match(text, /\*\*Version\*\* v\d+\.\d+\.\d+/, 'the version of the bot');
  assert.match(text, /\*\*Online for\*\* 3 hours/, 'how long it has been up');
  assert.match(text, /\*\*Servers\*\* 281/, 'the servers of the whole bot, not only the ones of this instance');
  assert.match(text, /\*\*Members\*\* 56,000/, 'and their members');
  assert.match(text, /\*\*Shards\*\* 6/); assert.match(text, /\*\*Clusters\*\* 3/, 'Discloud, Miami and Virginia');
  assert.match(text, /\*\*Name\*\* Petto Support/); assert.match(text, /\*\*Owner\*\* <@293504726505357312>/);
  assert.match(text, /\*\*Members\*\* 1,234/); assert.match(text, /\*\*Channels\*\* 12/); assert.match(text, /\*\*Roles\*\* 7/);
  assert.match(text, new RegExp(`\\*\\*Created\\*\\* <t:${Math.floor(CREATED / 1000)}:D>`), 'when the server was made');
  assert.match(text, /\*\*Shard\*\* 4 of 6 · Virginia · Virginia, US/, 'the shard of the server (counted from 1) and the instance that holds it');
  assert.match(text, /Powered by \[CubePath\]\(https:\/\/cubepath\.com\) and \[Discloud\]\(https:\/\/discloud\.com\)/, 'the credits, with a link to each host');
  assert.deepEqual(card.links.map((link) => link.url), ['https://petto.sbs', 'https://petto.sbs/support', 'https://petto.sbs/status', 'https://petto.sbs/invite', 'https://petto.sbs/premium'], 'the five links');

  // ---- The other languages ---------------------------------------------------------------------------------------------------------
  const es = readCard(await about.buildAboutCard({ lang: 'es', client, guild }));
  assert.match(es.text, /\*\*Servidores\*\* 281/); assert.match(es.text, /Con la tecnología de \[CubePath\]/);
  assert.equal(es.links[4].url, 'https://petto.sbs/es/premium', 'Premium opens the page in the language');
  const pt = readCard(await about.buildAboutCard({ lang: 'pt-BR', client, guild }));
  assert.match(pt.text, /\*\*Servidores\*\* 281/); assert.match(pt.text, /Com a tecnologia de \[CubePath\]/);
  assert.equal(pt.links[4].url, 'https://petto.sbs/pt-br/premium');

  // ---- Without a server, and with the database down ---------------------------------------------------------------------------------
  const noGuild = readCard(await about.buildAboutCard({ lang: 'en', client, guild: null })).text;
  assert.ok(!noGuild.includes('This server'), 'no server, no section of the server');
  failing = true;
  const down = readCard(await about.buildAboutCard({ lang: 'en', client, guild })).text;
  assert.match(down, /\*\*Servers\*\* 1\b/, 'with the database down: what this process sees by itself');
  assert.ok(!down.includes('Clusters'), 'and no invented clusters'); assert.match(down, /\*\*Shard\*\* 4 of 6\b(?! ·)/, 'the shard without the place');
  failing = false;

  // ---- The helpers ------------------------------------------------------------------------------------------------------------------
  assert.equal(about.placeOf({ clusterName: 'Miami', clusterLocation: 'Florida, US' }), 'Miami · Florida, US');
  assert.equal(about.placeOf({ clusterName: 'Miami', clusterLocation: null }), 'Miami'); assert.equal(about.placeOf(undefined), null);
  const stale = STATUS.map((row) => ({ shardId: row.shard_id, status: row.status, fresh: row.cluster_name !== 'Miami', clusterName: row.cluster_name, clusterLocation: row.cluster_location }));
  assert.deepEqual(about.shardSummary(stale, 6), { shards: 6, clusters: 2 }, 'a cluster that has not reported lately is not counted as running');
  assert.deepEqual(about.shardSummary([], 1), { shards: 1, clusters: null });

  console.log('about: ok');
})().catch((error) => { console.error(error); process.exit(1); });
