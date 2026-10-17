// The moderation commands added after other bots' lists: the shortcuts that reach them, restricted commands, join passes,
// image and reaction mutes, forced nicknames, stripstaff, raid cleanup, temporary roles and the bulk hierarchy guard.
// Everything runs against fakes: no Discord, no database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');

const stub = (file, exports) => { const p = require.resolve(file); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const resolvedDb = require.resolve('../src/db/database');
require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: () => ({}) } };

// The logs and the database layers the commands reach, replaced by recorders.
const staffLogs = [];
stub('../src/logging/moreLog', { handleStaffAction: async (kind, client, guild, data) => staffLogs.push({ kind, ...data }) });
const guildRow = { guild_id: 'g1', image_mute_role_id: null, reaction_mute_role_id: null, mute_role_id: null };
stub('../src/db/guilds', { ensureGuild: async () => guildRow, updateGuild: async (id, patch) => Object.assign(guildRow, patch) });
const cases = [];
stub('../src/db/modActions', { createCase: async (row) => { cases.push(row); return { ...row, case_number: cases.length }; } });
const forcedRows = new Map();
stub('../src/db/forcedNicknames', {
  getForced: async (g, u) => forcedRows.get(u) ?? null,
  setForced: async (g, u, nick) => forcedRows.set(u, nick),
  removeForced: async (g, u) => forcedRows.delete(u),
  listForced: async () => [...forcedRows].map(([user_id, nickname]) => ({ user_id, nickname, set_by: 'mod' })),
});
const tempRows = [];
stub('../src/db/tempRoles', {
  addTempRole: async (guild_id, user_id, role_id, set_by, expires_at) => tempRows.push({ guild_id, user_id, role_id, set_by, expires_at }),
  listTempRoles: async () => tempRows,
  removeTempRole: async (g, u, r) => { const i = tempRows.findIndex((row) => row.user_id === u && row.role_id === r); if (i >= 0) tempRows.splice(i, 1); return i >= 0; },
  getExpiredTempRoles: async () => tempRows.filter((row) => new Date(row.expires_at).getTime() <= Date.now()),
});

const { runWithLanguage } = require('../src/i18n');

// ---------------------------------------------------------------------------------------------------------------------
// A small server: the owner, a moderator (position 10), a member below (5), a member at the same level (10), an admin
// above (20) and Petto (30).
function makeGuild() {
  const roles = new Collection();
  const everyone = { id: 'g1', name: '@everyone', position: 0, managed: false, permissions: { bitfield: 0n }, toString: () => '@everyone' };
  roles.set('g1', everyone);
  const created = [];
  const guild = {
    id: 'g1', ownerId: 'owner', name: 'Server',
    roles: {
      cache: roles,
      everyone,
      create: async (data) => { const role = makeRole(`r${created.length + 100}`, data.name, 1, 0n); roles.set(role.id, role); created.push(role); return role; },
    },
    channels: { cache: new Collection() },
    members: { cache: new Collection() },
    createdRoles: created,
  };
  guild.members.fetch = async (id) => {
    if (id === undefined || typeof id === 'object') return guild.members.cache;
    const member = guild.members.cache.get(String(id));
    if (!member) throw new Error('Unknown Member');
    return member;
  };
  return guild;
}

function makeRole(id, name, position, permissions = 0n, managed = false) {
  return { id, name, position, managed, permissions: { bitfield: permissions }, toString: () => `<@&${id}>` };
}

function makeMember(guild, id, position, { perms = [], bot = false, roles = [], joinedAgoMs = 10 * 86_400_000, nickname = null } = {}) {
  const top = makeRole(`top-${id}`, `top ${id}`, position);
  const cache = new Collection([[top.id, top], ...roles.map((role) => [role.id, role])]);
  const log = [];
  const member = {
    id, guild, nickname, log,
    user: { id, bot, username: `user${id}`, tag: `user${id}`, toString: () => `<@${id}>`, createdTimestamp: Date.now() - 400 * 86_400_000 },
    joinedTimestamp: Date.now() - joinedAgoMs,
    permissions: { has: (flag) => perms.includes('Administrator') || [].concat(flag).every((f) => perms.some((name) => PermissionFlagsBits[name] === f)) },
    roles: {
      cache,
      get highest() { return [...cache.values()].sort((a, b) => b.position - a.position)[0]; },
      add: async (role, reason) => { const list = [].concat(role); for (const r of list) cache.set(r.id ?? r, typeof r === 'string' ? makeRole(r, r, 1) : r); log.push(['add', list.map((r) => r.id ?? r), reason]); },
      remove: async (role, reason) => { const list = [].concat(role); for (const r of list) cache.delete(r.id ?? r); log.push(['remove', list.map((r) => r.id ?? r), reason]); },
    },
    get manageable() { return id !== guild.ownerId && member.roles.highest.position < guild.members.me.roles.highest.position; },
    get kickable() { return member.manageable; },
    get bannable() { return member.manageable; },
    get moderatable() { return member.manageable && !perms.includes('Administrator'); },
    setNickname: async (nick) => { member.nickname = nick; log.push(['nick', nick]); },
    kick: async () => log.push(['kick']),
    send: async () => {},
    toString: () => `<@${id}>`,
  };
  guild.members.cache.set(id, member);
  return member;
}

function setup() {
  const guild = makeGuild();
  const me = makeMember(guild, 'petto', 30, { perms: ['Administrator'] });
  guild.members.me = me;
  const owner = makeMember(guild, 'owner', 40, { perms: ['Administrator'] });
  const mod = makeMember(guild, 'mod', 10, { perms: ['ModerateMembers', 'ManageNicknames', 'ManageRoles', 'BanMembers', 'KickMembers', 'Administrator'] });
  const low = makeMember(guild, 'low', 5);
  const peer = makeMember(guild, 'peer', 10);
  const admin = makeMember(guild, 'admin', 20, { perms: ['Administrator'] });
  const banned = [];
  guild.members.ban = async (userId, options) => banned.push([userId, options]);
  return { guild, me, owner, mod, low, peer, admin, banned };
}

/** A pseudo interaction like the prefix one: options from `values`, the answer kept in `replies`. */
function interactionFor(moderator, guild, { sub = null, values = {} } = {}) {
  const replies = [];
  const get = (name, required) => {
    if (values[name] === undefined || values[name] === null) {
      if (required) throw new Error(`missing ${name}`);
      return null;
    }
    return values[name];
  };
  return {
    guild, member: moderator, user: moderator.user, client: { user: { id: 'petto' }, users: { fetch: async (id) => guild.members.cache.get(id)?.user ?? null } },
    channel: { id: 'c1' }, pettoLang: 'en', typedPrefix: '!', replies,
    options: { getSubcommand: () => sub, getSubcommandGroup: () => null, getString: get, getUser: get, getRole: get, getBoolean: get, getInteger: get, getChannel: get },
    deferReply: async () => {},
    reply: async (payload) => { replies.push(payload); return { awaitMessageComponent: async () => ({ customId: 'modbulk_confirm', update: async () => {} }) }; },
    editReply: async (payload) => { replies.push(payload); return { awaitMessageComponent: async () => ({ customId: 'modbulk_confirm', update: async () => {} }) }; },
  };
}
const lastText = (interaction) => {
  const payload = interaction.replies.at(-1);
  if (typeof payload === 'string') return payload;
  if (payload?.content) return payload.content;
  return JSON.stringify(payload?.components?.map((c) => c.toJSON?.() ?? c) ?? payload);
};

(async () => {
  // --- Prefix shortcuts: every route and word route reaches a real command and subcommand ---------------------------
  const logger = require('../src/utils/logger');
  const warnings = [];
  const realWarn = logger.warn;
  logger.warn = (...args) => warnings.push(args.join(' '));
  const realInfo = logger.info;
  logger.info = () => {};
  const { loadCommands } = require('../src/handlers/commandHandler');
  const client = {};
  loadCommands(client);
  logger.warn = realWarn;
  logger.info = realInfo;
  assert.deepEqual(warnings, [], 'no command name, alias or shortcut collides with another');

  const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');
  const { resolveSubcommandOptions } = require('../src/handlers/prefixInteraction');
  for (const route of DEFAULT_PREFIX_ROUTES) {
    const command = client.commands.get(route.command);
    assert.ok(command, `${route.alias} goes to a loaded command`);
    const json = command.data.toJSON();
    const subArgs = route.args.filter((arg) => !arg.startsWith('--') && !['on', 'warn'].includes(arg));
    assert.ok(resolveSubcommandOptions(json, subArgs), `${route.alias} reaches ${route.command} ${subArgs.join(' ')}`);
    for (const [word, target] of Object.entries(route.words ?? {})) assert.ok(resolveSubcommandOptions(json, target.args), `${route.alias} ${word} reaches ${route.command} ${target.args.join(' ')}`);
  }
  for (const alias of ['lock', 'unlock', 'topic', 'nsfw', 'drag', 'reason', 'warns', 'mhistory', 'modstats', 'iunmute', 'runmute', 'forcenick', 'temprole', 'jaillist', 'timeouts', 'newmembers', 'picperms']) {
    assert.ok(client.commandRoutes.has(alias), `!${alias} is a shortcut`);
  }
  assert.equal(client.commandRoutes.get('lock').command, 'channel', '!lock locks the channel (lockdown no longer takes the name)');
  for (const [alias, target] of [['unbanall', 'massunban'], ['hb', 'hardban'], ['nick', 'nickname'], ['untimeout', 'unmute'], ['antiraid', 'automod'], ['rc', 'restrictcommand'], ['recentban', 'raid'], ['imagemute', 'imute'], ['reactionmute', 'rmute'], ['strip', 'stripstaff']]) {
    assert.equal(client.commandAliases.get(alias), target, `!${alias} is ${target}`);
  }
  for (const card of ['nicknameconfig', 'raidconfig', 'threadconfig', 'stripstaffconfig', 'imuteconfig', 'rmuteconfig', 'clearinvitesconfig', 'restrictcommandconfig']) {
    assert.ok(client.commands.has(card), `!${card} is generated`);
  }

  const { applyWordRoute, restrictedFor } = require('../src/utils/commandRestrictions');
  assert.deepEqual(applyWordRoute(client.commands.get('timeout').prefixWords, 'timeout', 'list'), { commandName: 'mute', argText: 'list' });
  assert.deepEqual(applyWordRoute(client.commands.get('hardban').prefixWords, 'hardban', 'LIST'), { commandName: 'ban', argText: 'list true' });
  assert.deepEqual(applyWordRoute(client.commands.get('massunban').prefixWords, 'massunban', 'cancel'), { commandName: 'ban', argText: 'cancel' });
  assert.equal(applyWordRoute(client.commands.get('timeout').prefixWords, 'timeout', '@user 10m spam'), null, 'any other first word is left alone');
  assert.deepEqual(applyWordRoute(client.commandRoutes.get('forcenick').words, 'nickname', 'list'), { commandName: 'nickname', argText: 'forced' });

  // --- Restricted commands -----------------------------------------------------------------------------------------
  const store = { restrictionMap: async () => ({ ban: ['mods'], purge: ['cleaners', 'mods'] }) };
  const memberWith = (roleIds, { admin = false, id = 'm' } = {}) => ({ id, guild: { ownerId: 'owner' }, permissions: { has: (flag) => admin && flag === PermissionFlagsBits.Administrator }, roles: { cache: new Map(roleIds.map((r) => [r, {}])) } });
  assert.deepEqual(await restrictedFor('g', 'ban', memberWith([]), store), ['mods'], 'without the role the command is refused');
  assert.equal(await restrictedFor('g', 'ban', memberWith(['mods']), store), null);
  assert.equal(await restrictedFor('g', 'purge', memberWith(['cleaners']), store), null, 'any of the roles is enough');
  assert.equal(await restrictedFor('g', 'kick', memberWith([]), store), null, 'a command without rules is open');
  assert.equal(await restrictedFor('g', 'ban', memberWith([], { admin: true }), store), null, 'administrators always can');
  assert.equal(await restrictedFor('g', 'ban', memberWith([], { id: 'owner' }), store), null, 'the owner always can');
  assert.equal(await restrictedFor('g', 'ban', { id: 'x', guild: {}, permissions: String(PermissionFlagsBits.Administrator), roles: [] }, store), null, 'a raw interaction member with Administrator');
  assert.equal(await restrictedFor('g', 'ban', { id: 'x', guild: {}, permissions: '0', roles: ['mods'] }, store), null, 'a raw interaction member with the role');
  const { commandName } = require('../src/commands/config/restrictcommand');
  assert.equal(commandName(client, '!b'), 'ban', 'an alias is the command');
  assert.equal(commandName(client, 'lock'), 'channel', 'a shortcut is its command');
  assert.equal(commandName(client, 'nothing-here'), null);

  // --- Join passes: shared by the join checks, spent once -----------------------------------------------------------
  const { usePass } = require('../src/utils/joinPass');
  let passes = new Set(['newbie']);
  let lookups = 0;
  const passDb = { hasPass: async (g, u) => { lookups += 1; return passes.has(u); }, removePass: async (g, u) => passes.delete(u) };
  const joining = { id: 'newbie', guild: { id: 'g1' } };
  const [a, b] = await Promise.all([usePass(joining, passDb), usePass(joining, passDb)]);
  assert.deepEqual([a, b, lookups, passes.has('newbie')], [true, true, 1, false], 'two checks at once share one lookup and the pass is spent');
  assert.equal(await usePass({ id: 'stranger', guild: { id: 'g1' } }, passDb), false);

  // --- Bulk hierarchy guard -----------------------------------------------------------------------------------------
  const { bulkTargetBlocked, protectedLine } = require('../src/utils/moderationCommand');
  {
    const { guild, mod, low, peer, admin, owner, me } = setup();
    const interaction = interactionFor(mod, guild);
    assert.equal(bulkTargetBlocked(interaction, low, PermissionFlagsBits.BanMembers), null, 'a member below is fine');
    for (const target of [peer, admin, owner, me, mod]) assert.ok(bulkTargetBlocked(interaction, target, PermissionFlagsBits.BanMembers), `${target.id} is left alone`);
    assert.equal(bulkTargetBlocked(interaction, null, PermissionFlagsBits.BanMembers), null, 'a user not in the server (ban by ID) is not blocked here');
    assert.match(protectedLine([peer.user], 'en'), /Left alone .*<@peer>/);
    assert.equal(protectedLine([], 'en'), null);
  }

  // --- Bulk ban now skips members at or above the moderator ---------------------------------------------------------
  {
    stub('../src/utils/sanctionTemplates', { sanctionDM: async () => 'dm', sanctionReply: async () => {} });
    stub('../src/utils/caseLog', { logSanction: async () => {} });
    stub('../src/utils/userResolve', { resolveUsers: async (c, input, guild) => ({ users: input.split(' ').map((id) => guild.members.cache.get(id).user), failed: [] }) });
    delete require.cache[require.resolve('../src/commands/moderation/ban')];
    const ban = require('../src/commands/moderation/ban');
    const { guild, mod, banned } = setup();
    const interaction = interactionFor(mod, guild, { sub: 'users', values: { users: 'low peer admin owner' } });
    await ban.execute(interaction);
    assert.deepEqual(banned.map(([id]) => id), ['low'], 'only the member below is banned');
    assert.match(lastText(interaction), /Left alone/);
  }

  // --- Image and reaction mutes ----------------------------------------------------------------------------------------
  {
    const imute = require('../src/commands/moderation/imute');
    const rmute = require('../src/commands/moderation/rmute');
    const { guild, mod, low, peer } = setup();
    const overwrites = [];
    guild.channels.cache.set('c1', { id: 'c1', type: 0, permissionOverwrites: { edit: async (role, perms) => overwrites.push([role.id, perms]) } });
    guild.channels.cache.set('cat', { id: 'cat', type: 4, permissionOverwrites: { edit: async (role, perms) => overwrites.push([role.id, perms]) } });

    let interaction = interactionFor(mod, guild, { sub: 'user', values: { user: low.user } });
    await imute.execute(interaction);
    const imageRole = guild.createdRoles[0];
    assert.equal(guildRow.image_mute_role_id, imageRole.id, 'the role is made once and saved');
    assert.deepEqual(overwrites.map(([, perms]) => perms), [{ AttachFiles: false, EmbedLinks: false }, { AttachFiles: false, EmbedLinks: false }], 'every channel and category gets the overwrite');
    assert.ok(low.roles.cache.has(imageRole.id), 'the member gets the role');
    assert.equal(staffLogs.at(-1).kind, 'imuted');

    interaction = interactionFor(mod, guild, { sub: 'user', values: { user: low.user } });
    await imute.execute(interaction);
    assert.match(lastText(interaction), /already image muted/);
    assert.equal(guild.createdRoles.length, 1, 'the saved role is reused');

    interaction = interactionFor(mod, guild, { sub: 'remove', values: { user: low.user } });
    await imute.execute(interaction);
    assert.ok(!low.roles.cache.has(imageRole.id), 'iunmute takes it away');

    interaction = interactionFor(mod, guild, { sub: 'user', values: { user: peer.user } });
    await rmute.execute(interaction);
    assert.match(String(interaction.replies[0].content), /equal to or higher than yours/, 'a member at the same level is refused');
    interaction = interactionFor(mod, guild, { sub: 'user', values: { user: low.user } });
    await rmute.execute(interaction);
    assert.deepEqual(overwrites.at(-1)[1], { AddReactions: false, UseExternalEmojis: false, UseExternalStickers: false });
    assert.equal(staffLogs.at(-1).kind, 'rmuted');

    const { applyToNewChannel } = require('../src/utils/permissionMute');
    const fresh = [];
    await applyToNewChannel({ id: 'new', type: 0, guild, permissionOverwrites: { edit: async (role, perms) => fresh.push([role.id, perms]) } }, guildRow);
    assert.equal(fresh.length, 2, 'a new channel gets both overwrites');
  }

  // --- Nicknames, forced nicknames --------------------------------------------------------------------------------------
  {
    const nickname = require('../src/commands/moderation/nickname');
    const { guild, mod, low, peer } = setup();
    let interaction = interactionFor(mod, guild, { sub: 'set', values: { user: low.user, nickname: 'Pancake' } });
    await nickname.execute(interaction);
    assert.equal(low.nickname, 'Pancake');

    interaction = interactionFor(mod, guild, { sub: 'set', values: { user: peer.user, nickname: 'Nope' } });
    await nickname.execute(interaction);
    assert.equal(peer.nickname, null, 'a member at the same level keeps their nickname');

    interaction = interactionFor(mod, guild, { sub: 'set', values: { user: mod.user, nickname: 'Me' } });
    await nickname.execute(interaction);
    assert.equal(mod.nickname, 'Me', 'your own nickname is fine');

    interaction = interactionFor(mod, guild, { sub: 'set', values: { user: low.user, nickname: 'x'.repeat(33) } });
    await nickname.execute(interaction);
    assert.match(String(interaction.replies[0].content), /32 characters/);

    interaction = interactionFor(mod, guild, { sub: 'force', values: { user: low.user, nickname: 'Locked' } });
    await nickname.execute(interaction);
    assert.deepEqual([low.nickname, forcedRows.get('low'), staffLogs.at(-1).kind], ['Locked', 'Locked', 'nicknameForced']);

    interaction = interactionFor(mod, guild, { sub: 'set', values: { user: low.user, nickname: 'Other' } });
    await nickname.execute(interaction);
    assert.equal(low.nickname, 'Locked', 'a forced nickname is not changed by a plain set');
    assert.match(lastText(interaction), /forced nickname/);

    const { enforce } = require('../src/events/guildMemberUpdateForceNick');
    low.nickname = 'Changed by hand';
    assert.equal(await enforce(low), true);
    assert.equal(low.nickname, 'Locked', 'the forced nickname is put back');
    assert.equal(await enforce(low), false, 'nothing to do when it already matches');

    interaction = interactionFor(mod, guild, { sub: 'force', values: { user: low.user } });
    await nickname.execute(interaction);
    assert.ok(!forcedRows.has('low'), 'force without a nickname stops forcing');
    assert.equal(staffLogs.at(-1).kind, 'nicknameUnforced');
  }

  // --- stripstaff -----------------------------------------------------------------------------------------------------
  {
    const stripstaff = require('../src/commands/moderation/stripstaff');
    const { guild, mod, low, admin } = setup();
    const staffRole = makeRole('staff', 'Staff', 3, PermissionFlagsBits.BanMembers);
    const helperRole = makeRole('helper', 'Helper', 2, PermissionFlagsBits.ManageMessages);
    const fanRole = makeRole('fan', 'Fan', 2, PermissionFlagsBits.SendMessages);
    const highRole = makeRole('high', 'Bot Role', 4, PermissionFlagsBits.KickMembers, true);
    for (const role of [staffRole, helperRole, fanRole, highRole]) { low.roles.cache.set(role.id, role); guild.roles.cache.set(role.id, role); }
    assert.deepEqual(stripstaff.staffRolesOf(low).map((r) => r.id).sort(), ['helper', 'high', 'staff'], 'roles with staff permissions only');

    let interaction = interactionFor(mod, guild, { values: { user: low.user } });
    await stripstaff.execute(interaction);
    assert.deepEqual(low.log.at(-1).slice(0, 2), ['remove', ['staff', 'helper']], 'a role managed by Discord stays');
    assert.ok(low.roles.cache.has('fan') && low.roles.cache.has('high'));
    assert.equal(staffLogs.at(-1).kind, 'staffStripped');

    interaction = interactionFor(mod, guild, { values: { user: admin.user } });
    await stripstaff.execute(interaction);
    assert.match(String(interaction.replies[0].content), /equal to or higher than yours/, 'someone above the moderator is refused');
  }

  // --- raid cleanup ---------------------------------------------------------------------------------------------------
  {
    const raid = require('../src/commands/moderation/raid');
    const { guild, mod, banned } = setup();
    makeMember(guild, 'raider1', 1, { joinedAgoMs: 60_000 });
    makeMember(guild, 'raider2', 1, { joinedAgoMs: 120_000 });
    makeMember(guild, 'raidbot', 1, { joinedAgoMs: 60_000, bot: true });
    makeMember(guild, 'newpeer', 10, { joinedAgoMs: 30_000 });
    assert.deepEqual(raid.recentJoins(guild.members.cache, 5 * 60_000).map((m) => m.id), ['newpeer', 'raider1', 'raider2'], 'newest first, bots left out');

    cases.length = 0;
    const interaction = interactionFor(mod, guild, { sub: 'clean', values: { duration: '5m' } });
    await raid.execute(interaction);
    assert.deepEqual(banned.map(([id]) => id).sort(), ['raider1', 'raider2'], 'the members who joined are banned, the one at the moderator level is not');
    assert.deepEqual(cases.map((row) => row.type), ['ban', 'ban'], 'one case each');
    assert.equal(staffLogs.at(-1).kind, 'raidCleaned');

    const bad = interactionFor(mod, guild, { sub: 'clean', values: { duration: '9d' } });
    await raid.execute(bad);
    assert.match(String(bad.replies[0].content), /at most 7d/);
  }

  // --- temporary roles ------------------------------------------------------------------------------------------------
  {
    const role = require('../src/commands/moderation/role');
    const { guild, mod, low, peer } = setup();
    const vip = makeRole('vip', 'VIP', 3);
    guild.roles.cache.set('vip', vip);
    let interaction = interactionFor(mod, guild, { sub: 'temp', values: { user: low.user, role: vip, duration: '2h' } });
    await role.execute(interaction);
    assert.ok(low.roles.cache.has('vip'));
    assert.equal(tempRows.length, 1);
    assert.ok(Math.abs(new Date(tempRows[0].expires_at).getTime() - (Date.now() + 7_200_000)) < 5_000, 'it ends in two hours');

    interaction = interactionFor(mod, guild, { sub: 'temp', values: { user: peer.user, role: vip, duration: '2h' } });
    await role.execute(interaction);
    assert.ok(!peer.roles.cache.has('vip'), 'not on someone at the moderator level');

    interaction = interactionFor(mod, guild, { sub: 'temp', values: { user: low.user, role: vip, duration: '2y' } });
    await role.execute(interaction);
    assert.match(String(interaction.replies[0].content), /at most 1 year/);

    // The expiry job takes it away once the time is up.
    tempRows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const { processExpiredTempRoles } = require('../src/jobs/expireSanctions');
    const jobClient = { guilds: { fetch: async () => guild } };
    await processExpiredTempRoles(jobClient);
    assert.ok(!low.roles.cache.has('vip'), 'the role is removed');
    assert.equal(tempRows.length, 0, 'and the row is gone');

    // role add on someone above the moderator is refused, and a Discord refusal is said.
    interaction = interactionFor(mod, guild, { sub: 'add', values: { user: peer.user, roles: 'vip' } });
    await role.execute(interaction);
    assert.match(String(interaction.replies[0].content), /equal to or higher than yours/);
  }

  // --- The prefix reads the new forms --------------------------------------------------------------------------------
  {
    const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
    const { guild } = setup();
    const message = { guild, client: { users: { fetch: async (id) => guild.members.cache.get(id)?.user ?? null } }, channel: { id: 'c1' }, member: {}, author: {}, attachments: new Collection([['a', { url: 'https://cdn/x.png' }]]) };
    const purge = client.commands.get('purge');
    let built = await buildInteractionFromMessage(message, purge, purge.prefixArgs('bots 50'));
    assert.deepEqual([built.options.getInteger('amount'), built.options.getString('filter')], [50, 'bots']);
    built = await buildInteractionFromMessage(message, purge, purge.prefixArgs('contains free nitro now'));
    assert.equal(built.options.getString('text'), 'free nitro now');
    built = await buildInteractionFromMessage(message, purge, purge.prefixArgs('20 spam and eggs'));
    assert.deepEqual([built.options.getInteger('amount'), built.options.getString('text'), built.options.getString('starts_with')], [20, 'spam and eggs', null], 'the text keeps every word left');
    const channel = client.commands.get('channel');
    built = await buildInteractionFromMessage(message, channel, 'topic Rules are in the pinned message');
    assert.equal(built.options.getString('text'), 'Rules are in the pinned message');
    built = await buildInteractionFromMessage(message, client.commands.get('role'), 'give 123456789012345678 vip');
    assert.equal(built.options.getSubcommand(), 'add', 'role give is role add');
    built = await buildInteractionFromMessage(message, client.commands.get('case'), 'evidence 12');
    assert.equal(built.options.getAttachment('file').url, 'https://cdn/x.png', 'a file sent with the message fills a file option');
    built = await buildInteractionFromMessage({ ...message, attachments: new Collection() }, client.commands.get('case'), 'evidence 12 https://discord.com/channels/1/2/3');
    assert.deepEqual([built.options.getInteger('case'), built.options.getAttachment('file'), built.options.getString('link')], [12, null, 'https://discord.com/channels/1/2/3'], 'a link is the link, not the file');
    built = await buildInteractionFromMessage(message, client.commands.get('automod'), 'avatar on kick');
    assert.deepEqual([built.options.getSubcommand(), built.options.getBoolean('enabled'), built.options.getString('action')], ['no-avatar', true, 'kick'], '!antiraid avatar is automod no-avatar');
  }

  // --- The words of the new replies exist in the three languages -----------------------------------------------------
  for (const lang of ['es', 'pt-BR']) {
    const { t } = require('../src/i18n');
    assert.notEqual(t(lang, 'core.restricted', { command: 'ban', roles: '<@&1>' }), t('en', 'core.restricted', { command: 'ban', roles: '<@&1>' }));
    await runWithLanguage(lang, async () => assert.ok(t(lang, 'moderation.pmute.image.done', { emoji: '', user: 'x' }).length));
  }

  void MessageFlags;
  console.log('Checked the new moderation commands: shortcuts, restricted commands, join passes, image/reaction mutes, nicknames, stripstaff, raid, temporary roles and bulk hierarchy.');
})().catch((err) => { console.error(err); process.exit(1); });
