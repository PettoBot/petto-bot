// Checks that `/ban`, `/kick`, `/mute`, `/warn`, `/jail`, `/imagemute` and `/reactionmute` take the options of their action directly (no `/ban user`), that the prefix still has
// its subcommands, and that the commands that took the rest (`/unban`, `/banlist`, `/massunban cancel`, `/warnescalation`...) reach the same code with the right subcommand.
process.env.DISCORD_TOKEN ??= 'check';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.DISCLOUD_DATABASE_URL ??= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const { collectCommandData, collectGuildCommandData } = require('../src/handlers/commandHandler');
const { flattenSlash, slashJson } = require('../src/utils/slashJson');

const all = [...collectCommandData(), ...collectGuildCommandData()];
const json = (name) => all.find((each) => each.name === name);
const OPTIONS = {
  ban: ['user', 'duration', 'reason', 'delete_message_days'], kick: ['user', 'reason'], mute: ['user', 'duration', 'reason'], warn: ['user', 'reason'], jail: ['user', 'duration', 'reason'],
  imagemute: ['user', 'reason'], reactionmute: ['user', 'reason'],
};
for (const [name, options] of Object.entries(OPTIONS)) {
  assert.deepEqual((json(name).options ?? []).map((option) => option.name), options, `/${name} takes ${options.join(', ')} directly`);
  assert.ok((json(name).options ?? []).every((option) => option.type !== 1 && option.type !== 2), `/${name} has no subcommand`);
  const required = json(name).options.map((option) => Boolean(option.required));
  assert.ok(required.every((value, index) => !value || required.slice(0, index).every(Boolean)), `/${name}: the required options come first (Discord asks for it)`);
  // The descriptions of the options are translated (they were looked up by the path of the subcommand before it was flattened).
  assert.ok(json(name).options.every((option) => option.description_localizations?.['es-ES'] && option.description_localizations?.['pt-BR']), `/${name}: its options are described in Spanish and Portuguese`);
  assert.equal(json(name).description_localizations?.['es-ES'] !== json(name).description, true);
}
assert.ok(json('ban').default_member_permissions === '4' && json('kick').default_member_permissions === '2', 'each keeps its permission');

// The prefix builder still has the subcommands.
const ban = require('../src/commands/moderation/ban.js');
const names = ban.data.toJSON().options.map((option) => option.name);
for (const sub of ['user', 'users', 'temp', 'remove', 'remove-all', 'list', 'cancel']) assert.ok(names.includes(sub), `!ban ${sub} still exists for the prefix`);
assert.equal(flattenSlash({}, { options: [1] }).options[0], 1, 'a command with no slashFlatten is left as it is');
assert.ok(!slashJson(ban).options.every((option) => option.type !== 1), 'slashJson still has the subcommands (the umbrellas and the prefix read them)');

// What took the rest.
for (const name of ['unban', 'unmute', 'unjail', 'massunban']) assert.ok(json(name), `/${name} is a slash command`);
assert.deepEqual(json('unban').options.map((option) => option.name), ['user', 'reason']);
assert.deepEqual(json('banlist').options.map((option) => option.name), ['hard']);
assert.deepEqual(json('massunban').options.map((option) => option.name), ['reason', 'cancel']);
assert.deepEqual(json('warnescalation').options.map((option) => option.name), ['add', 'remove', 'list']);
for (const name of ['mutelist', 'jaillist', 'jailsetup', 'imageunmute', 'reactionunmute', 'banlist', 'warnescalation']) assert.ok(collectGuildCommandData().some((each) => each.name === name), `/${name} is in the server set`);
for (const name of ['unban', 'unmute', 'unjail']) assert.ok(collectCommandData().some((each) => each.name === name), `/${name} is global`);

// Each reaches the code of the old subcommand.
const seen = [];
const spy = (file, label) => { const command = require(file); command.execute = async (interaction) => { seen.push([label, interaction.options.getSubcommandGroup?.() ?? null, interaction.options.getSubcommand()]); }; };
spy('../src/commands/moderation/ban.js', 'ban'); spy('../src/commands/moderation/mute.js', 'mute'); spy('../src/commands/moderation/jail.js', 'jail'); spy('../src/commands/moderation/warn.js', 'warn');
spy('../src/commands/moderation/imute.js', 'imute'); spy('../src/commands/moderation/rmute.js', 'rmute');
const run = async (file, sub = null, booleans = {}) => {
  const command = require(file);
  await command.execute({ options: { getSubcommand: () => sub, getSubcommandGroup: () => null, getBoolean: (name) => booleans[name] ?? null } });
};
await_all();
async function await_all() {
  await run('../src/commands/moderation/unban.js'); await run('../src/commands/moderation/banlist.js'); await run('../src/commands/moderation/massunban.js');
  await run('../src/commands/moderation/massunban.js', null, { cancel: true });
  await run('../src/commands/moderation/unmute.js'); await run('../src/commands/moderation/mutelist.js'); await run('../src/commands/moderation/unjail.js');
  await run('../src/commands/moderation/jaillist.js'); await run('../src/commands/moderation/jailsetup.js');
  await run('../src/commands/moderation/imageunmute.js'); await run('../src/commands/moderation/reactionunmute.js');
  await run('../src/commands/moderation/warnescalation.js', 'add');
  assert.deepEqual(seen, [
    ['ban', null, 'remove'], ['ban', null, 'list'], ['ban', null, 'remove-all'], ['ban', null, 'cancel'],
    ['mute', null, 'remove'], ['mute', null, 'list'], ['jail', null, 'remove'], ['jail', null, 'list'], ['jail', null, 'setup'],
    ['imute', null, 'remove'], ['rmute', null, 'remove'], ['warn', 'escalation', 'add'],
  ]);
  console.log('check-plain-moderation: ok');
}
