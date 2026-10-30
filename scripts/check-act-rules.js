// Checks that the rules of a server reach /act like they reach the prefix, with the same function (utils/commandRules.js):
// `!disablecommand hug` turns off the action `hug` (not the others) for the slash command `/act love hug` and for `!hug`;
// `!disablecommand act` turns off every action; a rule for one channel only refuses there; `!restrictcommand hug` asks for the role.
// A refused slash use is answered privately (ephemeral) with the usual notice.
process.env.DISCORD_TOKEN ||= 'check';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
// The rules in memory: { command, channel_id } (channel_id null = the whole server), and the roles asked for a command.
let rules = [];
let restrictions = {};
stub('src/db/disabledCommands.js', {
  findCached: async (g, command, channel) => rules.find((r) => r.command === command && (r.channel_id === null || r.channel_id === channel)) ?? null,
});
stub('src/db/commandRestrictions.js', { restrictionMap: async () => restrictions });
stub('src/db/permissions.js', { hasCommandPermission: async () => true });
stub('src/db/roleplayStats.js', { getRoleplayCounter: async () => 1, recordRoleplayResponse: async () => ({ claimed: true, counterValue: 1 }) });
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://cdn.otakugifs.xyz/gifs/hug/a.gif' }) });

const { Collection, MessageFlags, PermissionsBitField } = require('discord.js');
const { loadCommands } = require('../src/handlers/commandHandler');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const interactionCreate = require('../src/events/interactionCreate');
const commandRules = require('../src/utils/commandRules');
const { GROUPS } = require('../src/utils/actions');
const { CATALOGS } = require('../src/i18n');

const client = { commands: new Collection() };
loadCommands(client);
const act = client.commands.get('act');
const groupOf = (name) => GROUPS.find((group) => group.actions.includes(name)).name;

const GUILD = '444444444444444444';
const ROOM = '666666666666666666';
const OTHER_ROOM = '666666666666666667';
const ana = { id: '111111111111111111', username: 'Ana', globalName: null, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1.png' };
let userSeq = 0;

/** `/act <group> <action>` through the real handler: what it answered, and whether the action ran. */
async function slash(action, { channelId = ROOM, roles = [], admin = false } = {}) {
  const replies = [];
  const base = {
    id: `7777777777777777${String(10 + (userSeq += 1))}`, commandName: 'act', commandType: 1, user: { ...ana, id: String(BigInt(ana.id) + BigInt(userSeq)) },
    guild: { id: GUILD, ownerId: '1' }, guildId: GUILD, channelId, channel: { id: channelId },
    member: { id: ana.id, guild: { ownerId: '1' }, permissions: new PermissionsBitField(admin ? PermissionsBitField.Flags.Administrator : 0n), roles: { cache: { has: (id) => roles.includes(id) } } },
    locale: 'en-US', pettoLang: 'en', client,
    options: { getSubcommand: () => action, getSubcommandGroup: () => groupOf(action), getUser: () => null },
    deferred: false, replied: false,
    isChatInputCommand: () => true,
    reply: async (payload) => { replies.push({ how: 'reply', payload }); return {}; },
    deferReply: async () => { replies.push({ how: 'defer' }); },
    editReply: async (payload) => { replies.push({ how: 'edit', payload }); },
  };
  const interaction = new Proxy(base, { get: (target, key) => (key in target ? target[key] : (typeof key === 'string' && /^is[A-Z]/.test(key) ? () => false : undefined)) });
  await interactionCreate.execute(interaction, client);
  const ran = replies.some((r) => r.how === 'edit' && r.payload.embeds);
  const refusal = replies.find((r) => r.how === 'reply');
  return { ran, refusal: refusal?.payload ?? null };
}
const text = (payload) => JSON.stringify((payload.components ?? []).map((component) => component.toJSON?.() ?? component)) + (payload.content ?? '');
const refused = (result) => result.refusal && !result.ran && (result.refusal.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;

(async () => {
  // Nothing set: it runs.
  let result = await slash('hug');
  assert.ok(result.ran && !result.refusal, 'with no rule /act love hug runs');

  // `!disablecommand hug`: refused privately, with the usual notice naming the action; the other actions still run.
  rules = [{ command: 'hug', channel_id: null }];
  result = await slash('hug');
  assert.ok(refused(result), 'hug is refused when it is disabled');
  assert.ok(text(result.refusal).includes('/act love hug'), 'the notice names the action');
  assert.ok(text(result.refusal).includes('disabled') || text(result.refusal).includes(CATALOGS.en['core.disabled.server'].split('{')[0].trim().slice(0, 6)), 'it is the usual notice');
  assert.ok((await slash('pat')).ran, 'a different action still works');
  assert.ok((await slash('slap')).ran, 'and another one');

  // `!disablecommand act`: every action is refused.
  rules = [{ command: 'act', channel_id: null }];
  for (const action of ['hug', 'pat', 'slap', 'yay']) {
    result = await slash(action);
    assert.ok(refused(result), `${action} is refused when act is disabled`);
    assert.ok(text(result.refusal).includes('/act') && !text(result.refusal).includes('/act love'), 'the notice names the command');
  }

  // A rule for one channel: refused there only (for the action, and for the whole command).
  rules = [{ command: 'hug', channel_id: ROOM }];
  assert.ok(refused(await slash('hug', { channelId: ROOM })), 'refused in that channel');
  assert.ok(text((await slash('hug', { channelId: ROOM })).refusal).includes(`<#${ROOM}>`), 'the notice names the channel');
  assert.ok((await slash('hug', { channelId: OTHER_ROOM })).ran, 'allowed in another channel');
  assert.ok((await slash('pat', { channelId: ROOM })).ran, 'another action is allowed in that channel');
  rules = [{ command: 'act', channel_id: ROOM }];
  assert.ok(refused(await slash('pat', { channelId: ROOM })) && (await slash('pat', { channelId: OTHER_ROOM })).ran, 'act limited to one channel');

  // `!restrictcommand hug @Role`: members without the role are refused (an administrator is not), the other actions are not asked for it.
  rules = [];
  restrictions = { hug: ['900000000000000001'] };
  result = await slash('hug');
  assert.ok(refused(result) && text(result.refusal).includes('<@&900000000000000001>'), 'a restricted action asks for the role');
  assert.ok((await slash('hug', { roles: ['900000000000000001'] })).ran, 'with the role it runs');
  assert.ok((await slash('hug', { admin: true })).ran, 'an administrator always can');
  assert.ok((await slash('pat')).ran, 'another action is not restricted');
  restrictions = { act: ['900000000000000002'] };
  assert.ok(refused(await slash('pat')), 'a restriction on act asks for the role in every action');
  restrictions = {};

  // The prefix asks the same function: the names of a use, whichever way it was typed.
  const route = client.commandRoutes.get('hug');
  assert.deepEqual(commandRules.ruleNames(act, { route }), ['hug', 'act'], '!hug');
  assert.deepEqual(commandRules.ruleNames(act, { subcommand: 'hug' }), ['hug', 'act'], '/act love hug');
  assert.deepEqual(commandRules.ruleNames(act, { route: client.commandRoutes.get('hf') }), ['highfive', 'act'], 'a short word is its action');
  assert.deepEqual(commandRules.ruleNames(client.commands.get('ban'), { subcommand: 'x' }), ['ban'], 'a command without actions has its own name only');
  assert.equal(commandRules.subcommandOfText(act, 'love hug <@2>'), 'hug', '!act love hug');
  assert.equal(commandRules.subcommandOfText(act, 'nothing'), null);
  assert.equal(commandRules.subcommandOfText(client.commands.get('ban'), 'x'), null);
  rules = [{ command: 'hug', channel_id: ROOM }];
  assert.equal((await commandRules.disabledFor(GUILD, ['hug', 'act'], ROOM)).name, 'hug');
  assert.equal(await commandRules.disabledFor(GUILD, ['hug', 'act'], OTHER_ROOM), null);
  rules = [{ command: 'act', channel_id: null }];
  assert.equal((await commandRules.disabledFor(GUILD, ['hug', 'act'], ROOM)).name, 'act', 'the whole command disables the action');
  // The command (the prefix typed as `!act love hug`, or `!hug`) is read by messageCreateCommands with this function.
  const source = require('node:fs').readFileSync(path.join(__dirname, '../src/events/messageCreateCommands.js'), 'utf8');
  assert.match(source, /commandRules\.disabledFor\(/);
  assert.match(source, /commandRules\.restrictedForNames\(/);
  assert.doesNotMatch(source, /disabledDb\.findCached/, 'the prefix does not keep its own copy of the check');
  const slashSource = require('node:fs').readFileSync(path.join(__dirname, '../src/events/interactionCreate.js'), 'utf8');
  assert.match(slashSource, /commandRules\.disabledFor\(/);
  assert.match(slashSource, /commandRules\.restrictedForNames\(/);
  assert.doesNotMatch(slashSource, /disabledCommandsDb\.findCached/);

  console.log('Checked the rules of a server on /act: one action off, the whole command off, one channel, a role restriction, and the same function as the prefix.');
  setTimeout(() => process.exit(0), 10);
})().catch((err) => { console.error(err); process.exit(1); });
