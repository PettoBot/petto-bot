// Checks "stay in voice" (db/stayVoice.ts, utils/stayVoice.ts, jobs/stayVoiceJob.ts, events/voiceStateUpdateStayVoice.ts, /247): how the status text is kept, what Petto asks Discord when it joins,
// that it waits for the music, comes back after being moved, writes the status of the channel (and says so when it cannot), and the places where it is all connected.
// Discord and the database are replaced: nothing leaves this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) { failed += 1; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); } };

// ---- the text of the status ----
const store = require('../src/db/stayVoice');
check('status: default and empty are null', store.cleanStatus('default') === null && store.cleanStatus('  DEFAULT ') === null && store.cleanStatus('') === null && store.cleanStatus(undefined) === null);
check('status: one line, trimmed', store.cleanStatus('  hello \n  world  ') === 'hello world');
check('status: cut at the limit', (() => { const s = store.cleanStatus('x'.repeat(500)); return s.length === store.MAX_STATUS && s.endsWith('…'); })());
check('status: the limit is 120', store.MAX_STATUS === 120);

// ---- the work, with a stand-in Discord ----
const stay = require('../src/utils/stayVoice');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const music = require('../src/music/node');
const sent = [];
const puts = [];
function world({ channelType = ChannelType.GuildVoice, perms = { view: true, connect: true, status: true }, joinOnSend = true, putFails = null } = {}) {
  const me = { voice: { channelId: null, selfDeaf: false } };
  const channel = {
    id: 'C1', type: channelType,
    permissionsFor: () => ({ has: (flag) => (flag === PermissionFlagsBits.ViewChannel ? perms.view : flag === PermissionFlagsBits.Connect ? perms.connect : flag === PermissionFlagsBits.SetVoiceChannelStatus ? perms.status : false) }),
  };
  const guild = {
    id: 'G1', members: { me }, channels: { cache: new Map([['C1', channel]]) },
    shard: { send: (data) => { sent.push(data); if (!joinOnSend) return; me.voice.channelId = data.d.channel_id; me.voice.selfDeaf = data.d.self_deaf; } },
  };
  guild.client = {
    user: { id: 'B' }, guilds: { cache: new Map([['G1', guild]]) },
    rest: { put: async (route, opts) => { puts.push({ route, body: opts.body }); if (putFails) throw putFails; } },
  };
  guild.client.guilds.cache.get('G1').client = guild.client;
  return { guild, client: guild.client, me };
}
const rowOf = (extra = {}) => ({ guildId: 'G1', channelId: 'C1', status: null, deaf: true, enabled: true, ...extra });

const keepAlive = setInterval(() => {}, 1000); // the waits of the module use unref'd timers
(async () => {
  // not a voice channel / no permissions: it says what is missing and sends nothing
  {
    sent.length = 0; puts.length = 0;
    const { guild } = world({ channelType: ChannelType.GuildText });
    check('problem: a text channel', stay.problemWith(guild.channels.cache.get('C1'), guild) === 'notVoice');
    check('problem: a missing channel', stay.problemWith(null, guild) === 'notVoice');
    check('problem: a stage is not accepted', stay.problemWith({ type: ChannelType.GuildStageVoice }, guild) === 'notVoice');
    const noView = world({ perms: { view: false, connect: true, status: true } });
    check('problem: cannot see it', stay.problemWith(noView.guild.channels.cache.get('C1'), noView.guild) === 'view');
    const noConnect = world({ perms: { view: true, connect: false, status: true } });
    check('problem: cannot connect', stay.problemWith(noConnect.guild.channels.cache.get('C1'), noConnect.guild) === 'connect');
    const out = await stay.ensure(noConnect.client, rowOf(), { waitMs: 50 });
    check('ensure: a missing permission is said and nothing is sent', !out.ok && out.reason === 'connect' && sent.length === 0);
  }
  // joins muted and deaf, then writes the status (the default text of the language)
  {
    sent.length = 0; puts.length = 0;
    const { client } = world();
    const out = await stay.ensure(client, rowOf(), { waitMs: 500 });
    check('join: ok and the status is written', out.ok && out.status === 'written', JSON.stringify(out));
    check('join: asks for the channel, muted and with the sound off', sent.length === 1 && sent[0].op === 4 && sent[0].d.channel_id === 'C1' && sent[0].d.guild_id === 'G1' && sent[0].d.self_mute === true && sent[0].d.self_deaf === true, JSON.stringify(sent));
    check('join: the status goes to the voice-status route', puts.length === 1 && puts[0].route === '/channels/C1/voice-status' && /24\/7/.test(puts[0].body.status), JSON.stringify(puts));
    const again = await stay.ensure(client, rowOf(), { waitMs: 500 });
    check('join: already there and written, nothing again', again.ok && again.status === 'skipped' && sent.length === 1 && puts.length === 1, JSON.stringify(again));
    const changed = await stay.ensure(client, rowOf({ status: 'Hello' }), { waitMs: 500 });
    check('status: a changed text is written at once', changed.ok && changed.status === 'written' && puts.length === 2 && puts[1].body.status === 'Hello');
    const sound = await stay.ensure(client, rowOf({ status: 'Hello', deaf: false }), { waitMs: 500 });
    check('deaf: turning it off asks Discord again', sound.ok && sent.length === 2 && sent[1].d.self_deaf === false);
  }
  // the music has the connection: it waits
  {
    sent.length = 0; puts.length = 0;
    const { client } = world();
    const real = music.get;
    music.get = () => ({ players: new Map([['G1', {}]]) });
    const out = await stay.ensure(client, rowOf(), { waitMs: 50 });
    music.get = real;
    check('music: it waits while music plays', !out.ok && out.reason === 'music' && sent.length === 0);
  }
  // Discord does not put it in
  {
    sent.length = 0; puts.length = 0;
    const { client } = world({ joinOnSend: false });
    const out = await stay.ensure(client, rowOf(), { waitMs: 100 });
    check('join: when it does not get in, it says so and writes no status', !out.ok && out.reason === 'notThere' && puts.length === 0);
  }
  // no permission to set the status: it stays in, and says it
  {
    sent.length = 0; puts.length = 0;
    const { client } = world({ perms: { view: true, connect: true, status: false } });
    const out = await stay.ensure(client, rowOf(), { waitMs: 500 });
    check('status: without the permission it stays and says it', out.ok && out.status === 'noPermission' && puts.length === 0, JSON.stringify(out));
  }
  {
    sent.length = 0; puts.length = 0;
    const { client } = world({ putFails: Object.assign(new Error('Missing Permissions'), { code: 50013, status: 403 }) });
    const out = await stay.ensure(client, rowOf(), { waitMs: 500 });
    check('status: a refusal of Discord is not an error, it is "no permission"', out.ok && out.status === 'noPermission', JSON.stringify(out));
  }
  // leaving: the status is cleared and Petto leaves
  {
    sent.length = 0; puts.length = 0;
    const { client } = world();
    await stay.ensure(client, rowOf(), { waitMs: 500 });
    sent.length = 0; puts.length = 0;
    await stay.release(client, 'G1', 'C1');
    check('release: clears the status and leaves', puts.length === 1 && puts[0].body.status === '' && sent.length === 1 && sent[0].d.channel_id === null);
  }
})().then(() => {
  clearInterval(keepAlive);
  // ---- where it is all connected ----
  const command = read('src/commands/utility/247.ts');
  check('command: its own slash command in the second set', /registerSlash: true/.test(command) && /guildScoped: true/.test(command) && /setName\('247'\)/.test(command));
  check('command: needs Manage Server', /ManageGuild/.test(command));
  check('command: subcommands set, off, status and info', ['set', 'off', 'status', 'info'].every((name) => command.includes(`setName('${name}')`)));
  check('command: only voice channels can be chosen', /addChannelTypes\(ChannelType\.GuildVoice\)/.test(command));
  check('job: started in index.js', /startStayVoiceJob\(client\)/.test(read('index.js')));
  check('job: listed in the load guard', /'stayVoiceJob'/.test(read('src/utils/loadGuard.js')));
  check('event: moved or kicked, it comes back', /onBotMoved/.test(read('src/events/voiceStateUpdateStayVoice.ts')));
  check('schema: the table is there with row level security', /create table if not exists stay_voice/i.test(read('src/db/schema.sql')) && /alter table stay_voice enable row level security/i.test(read('src/db/schema.sql')));
  check('catalogs: the same keys in es and pt-BR', (() => {
    const keys = (lang) => Object.keys(require(`../src/i18n/locales/${lang}/stayvoice.js`)).sort().join('|');
    return keys('en') === keys('es') && keys('en') === keys('pt-BR');
  })());
  if (failed) { console.log(`${failed} stay-voice checks failed`); process.exit(1); }
  console.log('stay voice checks ok');
}).catch((error) => { console.error(error); process.exit(1); });
