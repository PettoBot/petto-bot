// Checks what the bot says when Discord refuses something for a permission (src/utils/permissionDiagnosis.ts, permissionAlerts.ts, db/permissionAlerts.ts):
// the error is read (its method, address and body), what Petto really has is looked at, and the answer names the permission and where it is missing, or the role/member that is
// above Petto. When it cannot be known, nothing is guessed. The staff is told once a day per problem, only in the log channel. The database and Discord are replaced: nothing leaves this script.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionsBitField, PermissionFlagsBits: F } = require('discord.js');

process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) { failed += 1; console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`); } };

// The database and the notice are replaced before the modules load.
const stub = (file, exports) => { const full = require.resolve(path.join(root, file)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const rows = new Map(); const claims = new Map(); const sent = [];
stub('src/db/permissionAlerts.js', {
  record: async (input) => { const old = rows.get(`${input.guildId}|${input.key}`); const row = { ...input, occurrences: (old?.occurrences ?? 0) + (input.count ?? 1) }; rows.set(`${input.guildId}|${input.key}`, row); return row; },
  claimNotice: async (guildId, key) => { const id = `${guildId}|${key}`; if (claims.has(id)) return null; claims.set(id, true); return rows.get(id); },
  list: async () => [], remove: async () => true, forgetOld: async () => {},
});
stub('src/utils/guildOpsAlerts.js', { sendGuildNotice: async (client, options) => { sent.push(options); return { ok: true }; } });

const diag = require('../src/utils/permissionDiagnosis');
const alerts = require('../src/utils/permissionAlerts');
const { permissionHelp, notePermissionProblem } = require('../src/utils/permissionErrors');

const GUILD = '1414452131850879080';
const CH = '111111111111111111';
const ROLE = '222222222222222222';
const USER = '333333333333333333';
const bits = (...flags) => new PermissionsBitField(flags.map((flag) => F[flag]));
const ALL_BUT = (...without) => new PermissionsBitField(Object.keys(F).filter((flag) => flag !== 'Administrator' && !without.includes(flag)).map((flag) => F[flag]));

function makeGuild({ me = ALL_BUT(), channels = {}, roles = [], members = [], top = 10 } = {}) {
  const guild = {
    id: GUILD, ownerId: '999999999999999999',
    channels: { cache: new Map(Object.entries(channels).map(([id, perms]) => [id, { id, name: 'general', isThread: () => false, permissionsFor: () => perms }])) },
    roles: { cache: new Map(roles.map((role) => [role.id, role])) },
    members: { cache: new Map(members.map((member) => [member.id, member])), me: { id: '1489326875498119168', permissions: me, roles: { highest: { position: top } } } },
    client: { guilds: { cache: new Map() }, channels: { cache: new Map() } },
  };
  guild.client.guilds.cache.set(GUILD, guild);
  for (const channel of guild.channels.cache.values()) { channel.guild = guild; guild.client.channels.cache.set(channel.id, channel); }
  return guild;
}
const err = (method, url, json) => ({ code: 50013, method, url: `https://discord.com/api/v10${url}`, requestBody: { json } });

(async () => {
  // --- a message in a channel without Send Messages ---
  let guild = makeGuild({ channels: { [CH]: ALL_BUT('SendMessages') } });
  let d = diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { content: 'hi' }));
  check('send: missing', d.kind === 'missing' && d.missing.length === 1 && d.missing[0].flag === 'SendMessages' && d.missing[0].scope === 'channel' && d.missing[0].channelId === CH, JSON.stringify(d));
  let text = alerts.explain(err('POST', `/channels/${CH}/messages`, { content: 'hi' }), 'en', guild);
  check('send: text says what and where', /\*\*Send Messages\*\*/.test(text) && text.includes(`<#${CH}>`), text);
  check('send: spanish', /Enviar mensajes/.test(alerts.explain(err('POST', `/channels/${CH}/messages`, { content: 'hi' }), 'es', guild)));
  check('send: portuguese', /Enviar mensagens/.test(alerts.explain(err('POST', `/channels/${CH}/messages`, { content: 'hi' }), 'pt-BR', guild)));

  // --- an embed needs Embed Links, a file needs Attach Files, and two missing are both said ---
  guild = makeGuild({ channels: { [CH]: ALL_BUT('EmbedLinks', 'AttachFiles') } });
  d = diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { embeds: [{}], attachments: [{ id: 0 }] }));
  check('embed+file: both', d.missing.map((m) => m.flag).sort().join() === 'AttachFiles,EmbedLinks', JSON.stringify(d.missing));
  check('embed+file: plain text has no embed need', diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { content: 'x' })).kind === 'unknown');
  check('embed+file: many', /Embed Links.*Attach Files|Attach Files.*Embed Links/.test(alerts.explain(err('POST', `/channels/${CH}/messages`, { embeds: [{}], attachments: [{}] }), 'en', guild)));

  // --- the server's permissions ---
  guild = makeGuild({ me: ALL_BUT('BanMembers') });
  d = diag.diagnoseError(guild, err('PUT', `/guilds/${GUILD}/bans/${USER}`, { delete_message_seconds: 0 }));
  check('ban: server scope', d.kind === 'missing' && d.missing[0].flag === 'BanMembers' && d.missing[0].scope === 'server', JSON.stringify(d));
  text = alerts.explain(err('PUT', `/guilds/${GUILD}/bans/${USER}`, {}), 'en', guild);
  check('ban: text', /\*\*Ban Members\*\* in this server/.test(text), text);
  check('ban: spanish', /Banear miembros|Expulsar|Vetar/.test(alerts.explain(err('PUT', `/guilds/${GUILD}/bans/${USER}`, {}), 'es', guild)));
  guild = makeGuild({ me: ALL_BUT('ModerateMembers') });
  check('timeout', diag.diagnoseError(guild, err('PATCH', `/guilds/${GUILD}/members/${USER}`, { communication_disabled_until: 'x' })).missing[0]?.flag === 'ModerateMembers');

  // --- roles: above Petto's, or made by an integration ---
  guild = makeGuild({ roles: [{ id: ROLE, name: 'VIP', position: 20, managed: false }] });
  d = diag.diagnoseError(guild, err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`));
  check('role above: hierarchy', d.kind === 'hierarchy' && d.role?.id === ROLE && d.role.name === 'VIP', JSON.stringify(d));
  text = alerts.explain(err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`), 'en', guild);
  check('role above: text', /VIP/.test(text) && /above my highest role/.test(text), text);
  guild = makeGuild({ roles: [{ id: ROLE, name: 'Booster', position: 1, managed: true }] });
  check('role managed', /integration/.test(alerts.explain(err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`), 'en', guild) ?? ''));
  guild = makeGuild({ roles: [{ id: ROLE, name: 'Low', position: 1, managed: false }] });
  check('role fine: nothing guessed', diag.diagnoseError(guild, err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`)).kind === 'unknown');
  guild = makeGuild({ me: ALL_BUT('ManageRoles'), roles: [{ id: ROLE, name: 'VIP', position: 20, managed: false }] });
  d = diag.diagnoseError(guild, err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`));
  check('role: permission and hierarchy together', d.kind === 'missing' && d.missing[0].flag === 'ManageRoles' && d.role?.id === ROLE);
  check('role: both told', /Manage Roles/.test(alerts.explain(err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`), 'en', guild)) && /VIP/.test(alerts.explain(err('PUT', `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`), 'en', guild)));

  // --- a member above Petto ---
  guild = makeGuild({ members: [{ id: USER, roles: { highest: { position: 30 } } }] });
  d = diag.diagnoseError(guild, err('DELETE', `/guilds/${GUILD}/members/${USER}`));
  check('kick: member above', d.kind === 'hierarchy' && d.member?.id === USER, JSON.stringify(d));
  check('kick: text', /as high as mine or higher/.test(alerts.explain(err('DELETE', `/guilds/${GUILD}/members/${USER}`), 'en', guild)));
  guild = makeGuild({ members: [{ id: GUILD.replace(/\d$/, '9'), roles: { highest: { position: 1 } } }] });
  check('kick: owner', diag.diagnoseError(makeGuild({ members: [{ id: '999999999999999999', roles: { highest: { position: 1 } } }] }), err('DELETE', `/guilds/${GUILD}/members/999999999999999999`)).kind === 'hierarchy');

  // --- nothing is guessed ---
  guild = makeGuild({ channels: { [CH]: ALL_BUT() } });
  check('unknown route', diag.diagnoseError(guild, err('POST', '/something/else', {})).kind === 'unknown');
  check('nothing missing', diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { content: 'x' })).kind === 'unknown');
  check('channel gone', diag.diagnoseError(makeGuild(), err('POST', `/channels/${CH}/messages`, { content: 'x' })).kind === 'unknown');
  check('no request in the error', diag.diagnoseError(guild, { code: 50013 }).kind === 'unknown' && alerts.explain({ code: 50013 }, 'en', guild) === null);
  check('no guild', alerts.explain(err('POST', `/channels/${CH}/messages`, {}), 'en', null) === null);
  check('generic text kept', /missing a permission/.test(permissionHelp({ code: 50013 }, 'en')) && /missing a permission/.test(permissionHelp({ code: 50013 }, 'en', { guild, feature: 'command:x' })));

  // --- threads ---
  guild = makeGuild({ channels: { [CH]: ALL_BUT('SendMessagesInThreads') } });
  guild.channels.cache.get(CH).isThread = () => true;
  check('thread: Send Messages in Threads', diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { content: 'x' })).missing[0]?.flag === 'SendMessagesInThreads');

  // --- the key of a problem, and when it is fixed ---
  guild = makeGuild({ channels: { [CH]: ALL_BUT('SendMessages') } });
  const one = diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { content: 'a' }));
  const same = diag.diagnoseError(guild, err('POST', `/channels/${CH}/messages`, { content: 'b' }));
  check('key: the same problem is one', diag.problemKey('command:ban', one) === diag.problemKey('command:ban', same));
  check('key: another feature is another problem', diag.problemKey('command:ban', one) !== diag.problemKey('event:guildMemberAdd', one));
  check('key: no ids of people', !/\d{15}/.test(diag.problemKey('command:x', diag.diagnoseError(makeGuild({ me: ALL_BUT('BanMembers') }), err('PUT', `/guilds/${GUILD}/bans/${USER}`, {})))));
  check('stillBroken: yes', diag.stillBroken(guild, { needs: one.missing }));
  check('stillBroken: fixed', !diag.stillBroken(makeGuild({ channels: { [CH]: ALL_BUT() } }), { needs: one.missing }));
  check('stillBroken: channel gone', !diag.stillBroken(makeGuild(), { needs: one.missing }));
  check('stillBroken: role fixed', !diag.stillBroken(makeGuild({ roles: [{ id: ROLE, name: 'x', position: 1, managed: false }] }), { needs: [], roleId: ROLE }) && diag.stillBroken(makeGuild({ roles: [{ id: ROLE, name: 'x', position: 50, managed: false }] }), { needs: [], roleId: ROLE }));

  // --- the staff is told once, in the log channel only ---
  alerts.forgetSeen(); rows.clear(); claims.clear(); sent.length = 0;
  const failure = err('POST', `/channels/${CH}/messages`, { content: 'x' });
  await alerts.reportPermissionProblem(failure, { guild, feature: 'command:ban' });
  await alerts.reportPermissionProblem(failure, { guild, feature: 'command:ban' });
  await alerts.reportPermissionProblem(failure, { guild, feature: 'command:ban' });
  check('notice: once', sent.length === 1, String(sent.length));
  check('notice: only for the staff, forced, own kind', sent[0]?.staffOnly === true && sent[0]?.kind === 'permissionAlert' && sent[0]?.guildId === GUILD && sent[0]?.force === true, JSON.stringify(sent[0]));
  check('notice: says what', /Send Messages/.test(sent[0]?.details ?? '') && (sent[0]?.details ?? '').includes(`<#${CH}>`) && /ban/.test(sent[0]?.details ?? ''), sent[0]?.details);
  check('notice: one row, counted', rows.size === 1 && [...rows.values()][0].occurrences === 1, JSON.stringify([...rows.values()]));
  await alerts.reportPermissionProblem(err('POST', '/x/y', {}), { guild, feature: 'task' });
  check('notice: unknown is not saved', rows.size === 1 && sent.length === 1);
  await alerts.reportPermissionProblem(failure, { guild, feature: 'event:guildMemberAdd' });
  check('notice: another feature is another problem', rows.size === 2 && sent.length === 2);
  notePermissionProblem(guild.client, { ...failure, code: 40002 }, { guild, feature: 'task' }); // not a permission error: ignored
  notePermissionProblem(guild.client, failure, { feature: 'task' }); // the server is found from the channel of the request
  await new Promise((resolve) => setImmediate(resolve));
  check('found from the address', alerts.guildOf(guild.client, failure) === guild && alerts.guildOf(guild.client, err('GET', `/guilds/${GUILD}/bans`, {})) === guild && alerts.guildOf(guild.client, err('GET', '/users/1', {})) === null);

  // --- the table and its statements ---
})().catch((error) => { failed += 1; console.log('FAIL exception', error); }).finally(() => {
  // --- the source: the statements, the hooks and the routes ---
  const sql = read('src/db/permissionAlerts.ts');
  check('sql: the notice is claimed in the database, 24 hours', /last_notified is null or last_notified < now\(\) - make_interval\(hours => \$3::int\)/.test(sql) && /notifyHours: 24/.test(sql));
  check('sql: upsert counts', /on conflict \(guild_id, problem_key\) do update set occurrences = permission_alerts\.occurrences \+ \$11::int/.test(sql));
  check('sql: limits', /perGuild: 40/.test(sql) && /forgetDays: 14/.test(sql));
  const schema = read('src/db/schema.sql');
  check('schema: table with row level security and guild_id', /create table if not exists permission_alerts \([\s\S]*?guild_id\s+text not null[\s\S]*?primary key \(guild_id, problem_key\)\s*\);/.test(schema) && /alter table permission_alerts enable row level security;/.test(schema));
  const ops = read('src/utils/guildOpsAlerts.js');
  check('notice: staff only means no DM and no team alert', /if \(!sent && !staffOnly\)/.test(ops) && /const shouldAlertTeam = !staffOnly && \(/.test(ops) && /permissionAlert: template\('permissionAlert', 'warning'\)/.test(ops));
  const hooks = {
    'src/events/interactionCreate.js': /permissionHelp\(err, lang, \{ guild: interaction\.guild, feature: `command:/,
    'src/events/messageCreateCommands.js': /permissionHelp\(err, lang, \{ guild: message\.guild, feature: `command:/,
    'src/utils/safeTicketAction.js': /permissionHelp\(error, await lang\(\), \{ guild: interaction\.guild \?\? null, feature: 'ticket' \}\)/,
    'src/handlers/eventHandler.js': /notePermissionProblem\(client, err, \{ guild: .*feature: `event:\$\{event\.name\}`/s,
    'src/utils/processGuards.js': /notePermissionProblem\(client, error\)/,
    'index.js': /installProcessGuards\(\{[^}]*client \}\)/,
  };
  for (const [file, pattern] of Object.entries(hooks)) check(`hook: ${file}`, pattern.test(read(file)));
  const server = read('src/web/server.js');
  check('route: list', /app\.get\('\/api\/dashboard\/guild\/:guildId\/permission-alerts', dashboardDatabaseRateLimiter, async/.test(server) && /listForDashboard\(access\.guild, lang\)/.test(server));
  check('route: dismiss', /app\.post\('\/api\/dashboard\/guild\/:guildId\/permission-alerts\/dismiss', dashboardDatabaseRateLimiter, async/.test(server));
  // Every permission the table can ask for has a name in the three languages.
  const flags = [...new Set([...read('src/utils/permissionDiagnosis.ts').matchAll(/(?:channelNeed|serverNeed)\('(\w+)'|: '(\w+)'|\? '(\w+)'/g)].map((m) => m[1] || m[2] || m[3]).filter((name) => name in F))];
  const { t } = require('../src/i18n');
  for (const lang of ['en', 'es', 'pt-BR']) for (const flag of flags) check(`name: ${flag} in ${lang}`, t(lang, `core.perm.${flag}`) !== `core.perm.${flag}`);
  check('flags found', flags.length >= 20, String(flags.length));
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log('permission-diagnosis: ok');
});
