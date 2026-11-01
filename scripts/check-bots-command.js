// Checks `!bots` (src/commands/utility/bots.js): the slash command slots that are left (global limits of Discord), the commands close to the
// 25 subcommands or 8000 characters, what is registered at Discord compared with what Petto loads, and the bots of the server; only for the Petto team.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
process.env.PETTO_DEVELOPER_IDS = '900000000000000001';
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const budget = require('../src/utils/slashBudget');
const command = require('../src/commands/utility/bots');

const sub = (name) => ({ type: 1, name, description: 'x' });
const chat = (name, subs = 0, description = 'A command.') => ({ type: 1, name, description, options: Array.from({ length: subs }, (_, i) => sub(`s${i}`)) });

(async () => {
  assert.deepEqual(budget.LIMITS, { chat: 100, user: 5, message: 5, subcommands: 25, size: 8000 });
  const registered = [...Array.from({ length: 30 }, (_, i) => chat(`c${i}`)), chat('level', 25), chat('forum', 23), { type: 2, name: 'Report User' }, { type: 3, name: 'Report Message' }, { type: 3, name: 'Quote' }];
  const usage = budget.slotUsage(registered);
  assert.deepEqual(usage.chat, { used: 32, limit: 100, free: 68 });
  assert.deepEqual(usage.user, { used: 1, limit: 5, free: 4 });
  assert.deepEqual(usage.message, { used: 2, limit: 5, free: 3 });
  assert.equal(budget.subcommandCount(chat('x', 7)), 7);
  assert.equal(budget.subcommandCount({ type: 1, name: 'y', options: [{ type: 3, name: 'a' }, { type: 2, name: 'g', options: [] }] }), 1, 'only subcommands and groups count');
  const near = budget.nearLimit(registered);
  assert.deepEqual(near.map((entry) => [entry.name, entry.full]), [['level', true], ['forum', false]], 'the fullest first, and which one is full');
  assert.ok(budget.commandSize({ name: 'ab', description: 'cde', options: [{ name: 'f', description: 'gh', choices: [{ name: 'ij', value: 'k' }] }] }) === 2 + 3 + 1 + 2 + 2 + 1, 'names, descriptions and choices add up');
  assert.deepEqual(budget.difference([{ type: 1, name: 'a' }, { type: 1, name: 'old' }], [{ type: 1, name: 'a' }, { type: 1, name: 'new' }]), { onlyRegistered: ['chat:old'], notRegistered: ['chat:new'] });

  // The command.
  assert.equal(command.prefixOnly, true); assert.equal(command.hiddenFromHelp, true);
  assert.equal(command.data.toJSON().name, 'bots');
  const members = new Collection([
    ['1', { id: '1', user: { bot: true, tag: 'Petto#0001', username: 'Petto' }, joinedTimestamp: 2000 }],
    ['2', { id: '2', user: { bot: true, tag: 'Other#0002', username: 'Other' }, joinedTimestamp: 1000 }],
    ['3', { id: '3', user: { bot: false, tag: 'ana#0', username: 'ana' }, joinedTimestamp: 500 }],
  ]);
  const loaded = [{ type: 1, name: 'c0' }].map((json) => ({ data: { toJSON: () => json } }));
  const make = (userId, { registeredList = registered, fail = false } = {}) => {
    const answers = [];
    const client = {
      user: { id: '1' },
      commands: new Collection([['c0', loaded[0]], ['prefixed', { prefixOnly: true, data: { toJSON: () => ({ type: 1, name: 'prefixed' }) } }]]),
      application: { commands: { fetch: async () => { if (fail) throw new Error('down'); return new Collection(registeredList.map((json, i) => [String(i), { toJSON: () => json }])); } } },
    };
    const interaction = {
      client, user: { id: userId }, guild: { memberCount: 3, members: { cache: members, fetch: async () => members } },
      deferReply: async () => {}, reply: async (payload) => { answers.push(payload); }, editReply: async (payload) => { answers.push(payload); },
    };
    return { interaction, answers };
  };
  const text = (payload) => JSON.stringify(payload.components.map((component) => component.toJSON()));

  let run = make('1');
  await command.execute(run.interaction);
  assert.match(text(run.answers[0]), /not available to this account/, 'only the Petto team');
  run = make('900000000000000001');
  await command.execute(run.interaction);
  const out = text(run.answers.at(-1));
  assert.match(out, /32 \/ 100\*\* \(68 left\)/, 'the slots of chat commands');
  assert.match(out, /User menus: \*\*1 \/ 5\*\* \(4 left\)/);
  assert.match(out, /`\/level` 25 \/ 25 subcommands.*\(full\)/, 'the command that is full');
  assert.match(out, /`\/forum` 23 \/ 25/, 'and the one that is close');
  assert.match(out, /At Discord but not loaded any more/, 'what is registered and no longer loaded');
  assert.match(out, /deploy-commands/, 'and how to fix it');
  assert.match(out, /Bots in this server: 2\*\*/, 'two bots');
  assert.ok(out.indexOf('Other#0002') < out.indexOf('Petto#0001'), 'the oldest first');
  assert.match(out, /\(Petto\)/, 'Petto is marked');
  assert.ok(!out.includes('ana#0'), 'people are not listed');
  // Discord cannot be asked: what Petto loads, with a warning.
  run = make('900000000000000001', { fail: true });
  await command.execute(run.interaction);
  assert.match(text(run.answers.at(-1)), /Discord could not be asked/);
  assert.match(text(run.answers.at(-1)), /1 \/ 100\*\* \(99 left\)/, 'a prefix only command is not counted');
  console.log('Checked !bots: slash command slots, the commands close to a limit, the difference with Discord and the bots of the server.');
})().catch((error) => { console.error(error); process.exit(1); });
