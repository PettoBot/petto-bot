// Checks the cards for a command typed wrong: a subcommand that does not exist (with what the person probably meant) and an
// option that is missing (with how to write it), with real commands.
const assert = require('node:assert/strict');
const path = require('node:path');
const { SlashCommandBuilder } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const { unknownSubcommandCard, missingOptionCard, suggest, listPaths, syntaxOf } = require('../src/utils/usageCard');

const text = (payload) => JSON.stringify(payload.components.map((c) => c.toJSON()));
const strip = (payload) => payload.components.flatMap((c) => c.toJSON().components).filter((n) => typeof n.content === 'string').map((n) => n.content).join('\n');

// A command like !boosterrole: subcommands, a group with children, and one with options.
const command = {
  data: new SlashCommandBuilder()
    .setName('boosterrole').setDescription('Booster roles.')
    .addSubcommand((s) => s.setName('create').setDescription('Create your booster role.').addStringOption((o) => o.setName('name').setDescription('Name of the role').setRequired(true)).addStringOption((o) => o.setName('color').setDescription('A hex color').setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove your role.'))
    .addSubcommandGroup((g) => g.setName('admin').setDescription('Staff tools.')
      .addSubcommand((s) => s.setName('list').setDescription('List every booster role.'))
      .addSubcommand((s) => s.setName('set').setDescription('Set a role.').addUserOption((o) => o.setName('member').setDescription('Who').setRequired(true)))),
  hiddenPrefixSubcommands: ['admin set'],
};

// The way to run it and what it needs.
assert.deepEqual(listPaths(command).map((entry) => entry.path), ['create', 'remove', 'admin list'], 'hidden ways are left out');
assert.equal(syntaxOf(',', 'boosterrole', 'create', command.data.toJSON().options[0].options), ',boosterrole create <name> [color]');

// The person typed ",br list": the word exists inside a group.
assert.deepEqual(suggest(listPaths(command), 'list').map((entry) => entry.path), ['admin list']);
assert.deepEqual(suggest(listPaths(command), 'creat').map((entry) => entry.path), ['create'], 'a start of the word');
assert.deepEqual(suggest(listPaths(command), 'remov').map((entry) => entry.path), ['remove']);
assert.deepEqual(suggest(listPaths(command), 'crete').map((entry) => entry.path), ['create'], 'one slip');
assert.deepEqual(suggest(listPaths(command), 'zzzzz'), [], 'nothing close, nothing suggested');
assert.deepEqual(suggest(listPaths(command), ''), []);

let card = unknownSubcommandCard({ command, prefix: ',', name: 'boosterrole', typed: 'list' });
let out = strip(card);
assert.match(out, /`list` is not a way to use `,boosterrole`/);
assert.match(out, /\*\*Did you mean\*\*\n> `,boosterrole admin list` · List every booster role\./);
assert.match(out, /\*\*What `,boosterrole` can do\*\*\n`create` · Create your booster role\.\n`remove` · Remove your role\.\n`admin list`/);
assert.match(out, /Full guide with `,help boosterrole`/);
assert.ok(!out.includes('admin set'), 'a hidden way is not shown');
assert.equal(card.flags, 1 << 15); assert.deepEqual(card.allowedMentions, { repliedUser: false, parse: [] });
card = unknownSubcommandCard({ command, prefix: '!', name: 'boosterrole', typed: 'zzzzz' });
assert.ok(!strip(card).includes('Did you mean'), 'no guess when nothing is close');
card = unknownSubcommandCard({ command, prefix: '!', name: 'boosterrole', typed: '' });
assert.match(strip(card), /`\(nothing\)` is not a way/);

// A long command is cut, with a count of what is left.
const big = { data: new SlashCommandBuilder().setName('big').setDescription('x') };
for (let n = 0; n < 20; n += 1) big.data.addSubcommand((s) => s.setName(`sub${n}`).setDescription(`Does thing ${n}.`));
out = strip(unknownSubcommandCard({ command: big, prefix: '!', name: 'big', typed: 'nothing' }));
assert.match(out, /…and 6 more/); assert.ok(out.length < 3500);

// A missing option.
card = missingOptionCard({ command, prefix: ',', name: 'boosterrole', argText: 'create', missing: 'name' });
out = strip(card);
assert.match(out, /`name` is missing/);
assert.match(out, /\*\*How to write it\*\*\n`,boosterrole create <name> \[color\]`/);
assert.match(out, /`name` · \*\*needed\*\* · text — Name of the role/);
assert.match(out, /`color` · optional · text — A hex color/);
assert.match(out, /`<needed>` `\[optional\]` · full guide with `,help boosterrole`/);
card = missingOptionCard({ command, prefix: ',', name: 'boosterrole', argText: 'admin set', missing: 'member' });
assert.match(strip(card), /`,boosterrole admin set <member>`/); assert.match(strip(card), /a member — Who/);
// Written in a way that cannot be read, with no option named.
card = missingOptionCard({ command, prefix: '!', name: 'boosterrole', argText: 'remove', missing: null });
assert.match(strip(card), /That does not look right for `!boosterrole remove`/); assert.match(strip(card), /`!boosterrole remove`/);
// A command with no subcommands.
const simple = { data: new SlashCommandBuilder().setName('avatar').setDescription('x').addUserOption((o) => o.setName('user').setDescription('Whose avatar').setRequired(true)) };
assert.match(strip(missingOptionCard({ command: simple, prefix: '!', name: 'avatar', argText: '', missing: 'user' })), /`!avatar <user>`/);
// The default subcommand (!remind 2h text is !remind add ...).
const remind = { prefixDefaultSubcommand: 'add', data: new SlashCommandBuilder().setName('remind').setDescription('x').addSubcommand((s) => s.setName('add').setDescription('Add.').addStringOption((o) => o.setName('duration').setDescription('When').setRequired(true))).addSubcommand((s) => s.setName('list').setDescription('List.')) };
assert.match(strip(missingOptionCard({ command: remind, prefix: '!', name: 'remind', argText: '', missing: 'duration' })), /`!remind add <duration>`/);
// What goes out is Discord's own limit-safe: under 4000 characters of text.
assert.ok(text(card).length < 6000);

console.log('usage card ok');
