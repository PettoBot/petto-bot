// Checks !disablecommand: the prefix forms people write (`!dc suggest #cmds`, the channel first, several commands, aliases,
// categories, "all"), what is saved (always the real command name), list grouped by channel, enable/clear, the notice a member
// sees when a command is off, and the replies in Spanish and Portuguese.
process.env.DISCORD_TOKEN ||= 'check';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// The rules in memory, the same shape as the table (channel_id null = the whole server).
const rules = [];
let nextId = 1;
const same = (r, command, channel) => r.command === command && (r.channel_id ?? null) === (channel ?? null);
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/commandAliases.js', { get: async (g, name) => (name === 'sugi' ? { name: 'sugi', command: 'suggest {0}' } : null) });
stub('src/db/disabledCommands.js', {
  find: async (g, command, channel) => rules.find((r) => r.command === command && (r.channel_id === null || r.channel_id === (channel ?? null))) ?? null,
  listForGuild: async () => rules.slice(),
  disableMany: async (g, commands, channels = [null]) => {
    const added = [];
    for (const command of commands) for (const channel of channels) {
      if (rules.some((r) => same(r, command, channel))) continue;
      const row = { id: nextId++, guild_id: g, command, channel_id: channel ?? null };
      rules.push(row); added.push(row);
    }
    return added;
  },
  enableMany: async (g, commands, channels = null) => {
    const gone = rules.filter((r) => commands.includes(r.command) && (!channels || channels.some((c) => (c ?? null) === r.channel_id)));
    for (const row of gone) rules.splice(rules.indexOf(row), 1);
    return gone;
  },
  clear: async (g, channel = null) => {
    const gone = rules.filter((r) => !channel || r.channel_id === channel);
    for (const row of gone) rules.splice(rules.indexOf(row), 1);
    return gone.length;
  },
});

const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const disablecommand = require('../src/commands/automation/disablecommand');

const fun = { category: 'fun', data: { name: '8ball', toJSON: () => ({ type: 1 }) } };
const commands = new Map([
  ['suggest', { category: 'community' }], ['suggestion', { category: 'community' }], ['rank', { category: 'leveling' }], ['8ball', fun],
  ['roll', { category: 'fun' }], ['help', { category: 'utility' }], ['disablecommand', { category: 'automation' }], ['channel', { category: 'moderation' }],
  ['serverinfo', { category: 'info' }],
].map(([name, extra]) => [name, { data: { name, toJSON: () => ({ type: 1 }) }, ...extra }]));
const client = {
  commands,
  commandAliases: new Map([['sug', 'suggest'], ['lvl', 'rank'], ['server', 'serverinfo']]),
  commandRoutes: new Map([['lock', { command: 'channel' }]]),
};

const channel = (id, name) => ({ id, name, toString: () => `<#${id}>` });
const channels = [channel('700000000000000001', 'cmds'), channel('700000000000000002', 'memes'), channel('700000000000000003', 'general')];
const cache = new Map(channels.map((c) => [c.id, c]));
cache.find = (fn) => channels.find(fn);
const guild = { id: '1', name: 'Test', iconURL: () => null, channels: { cache }, roles: { cache: new Map() }, members: { cache: new Map() } };

const text = (payload) => JSON.stringify((payload.components ?? []).map((c) => (c.toJSON ? c.toJSON() : c)));
const accent = (payload) => payload.components[0].toJSON().accent_color;

/** Runs `!dc <args>` the way messageCreateCommands.js does: prefixArgs, then the prefix parser, then the command. */
async function dc(args, lang = undefined) {
  const sent = [];
  const message = {
    guild, client, author: { id: '9' }, member: {}, channel: { id: '700000000000000003', send: async (p) => { sent.push(p); return p; } },
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    reply: async (p) => { sent.push(p); return p; },
  };
  const argText = disablecommand.prefixArgs(args);
  const interaction = await buildInteractionFromMessage(message, disablecommand, argText);
  assert.ok(interaction, `"!dc ${args}" is read as a subcommand of !disablecommand (got ${argText})`);
  interaction.pettoLang = lang;
  interaction.typedPrefix = '!';
  await disablecommand.execute(interaction);
  for (const payload of sent) for (const card of payload.components ?? []) assert.ok([undefined, 0xa5ea7a, 0xfe6465].includes((card.toJSON ? card.toJSON() : card).accent_color), `"!dc ${args}" answers with no color, or green or red`);
  return sent[0];
}
const saved = () => rules.map((r) => `${r.command}@${r.channel_id ? channels.find((c) => c.id === r.channel_id).name : 'server'}`).sort();

(async () => {
  // How the words are read, before anything runs.
  assert.equal(disablecommand.prefixArgs('suggest #cmds'), 'disable suggest #cmds');
  assert.equal(disablecommand.prefixArgs('#cmds suggest'), 'disable #cmds suggest');
  assert.equal(disablecommand.prefixArgs('#cmds enable suggest'), 'enable #cmds suggest');
  assert.equal(disablecommand.prefixArgs('#cmds'), 'list #cmds');
  assert.equal(disablecommand.prefixArgs(''), 'list');
  assert.equal(disablecommand.prefixArgs('remove rank'), 'enable rank');
  assert.equal(disablecommand.prefixArgs('reset'), 'clear');
  assert.deepEqual(disablecommand.splitTarget('suggest,rank,8ball <#700000000000000001>'), { names: ['suggest', 'rank', '8ball'], channels: ['<#700000000000000001>'], server: false });
  assert.deepEqual(disablecommand.splitTarget('suggest all'), { names: ['suggest'], channels: [], server: true });
  assert.deepEqual(disablecommand.splitTarget('all'), { names: ['all'], channels: [], server: true });

  // The form from the bug report: the command, then the channel, with no subcommand.
  let reply = await dc('suggest #cmds');
  let out = text(reply);
  assert.match(out, /Turned off in <#700000000000000001>/);
  assert.match(out, /`suggest`/);
  assert.match(out, /Undo: `!dc enable suggest #cmds`/);
  assert.equal(reply.components[0].toJSON().type, 17, 'a card (Components V2), not plain text');
  assert.ok([undefined, 0xa5ea7a, 0xfe6465].includes(accent(reply)), 'the card has no colored side bar');
  assert.deepEqual(saved(), ['suggest@cmds']);

  // The channel first, the same rule again, an alias and a mention.
  out = text(await dc('<#700000000000000001> sug'));
  assert.match(out, /Already off there: `suggest`/);
  assert.deepEqual(saved(), ['suggest@cmds'], 'an alias is saved as the real command, so it is not saved twice');

  // Several commands at once, comma or space separated, in two channels; a shortcut is saved as its command.
  out = text(await dc('rank,8ball lvl #memes 700000000000000003'));
  assert.match(out, /Turned off in <#700000000000000002>, <#700000000000000003>/);
  assert.deepEqual(saved(), ['8ball@general', '8ball@memes', 'rank@general', 'rank@memes', 'suggest@cmds']);
  await dc('lock #cmds');
  assert.ok(saved().includes('channel@cmds'), 'a shortcut (`lock`) is saved as its command (`channel`)');
  await dc('enable channel');

  // A server alias, "all" as the place, protected and unknown names, a typo, a channel that does not exist.
  out = text(await dc('disable sugi all'));
  assert.match(out, /Turned off on the whole server/);
  assert.ok(saved().includes('suggest@server'));
  out = text(await dc('help disablecommand sugestion nothing'));
  assert.match(out, /always stay on.*`help` · `disablecommand`/);
  assert.match(out, /don't know these commands: `sugestion` · `nothing`/);
  assert.match(out, /Did you mean `suggestion`/);
  reply = await dc('rank #nowhere');
  assert.match(text(reply), /can't find these channels: `#nowhere`/);
  assert.ok([undefined, 0xa5ea7a, 0xfe6465].includes(accent(reply)), 'errors have no colored side bar either');
  assert.match(text(await dc('disable all')), /Tell me which commands/);
  assert.match(text(await dc('server')), /Turned off on the whole server/, '`server` alone is the alias of serverinfo');
  assert.ok(saved().includes('serverinfo@server'));
  await dc('enable server');
  assert.match(text(await dc(Array.from({ length: 30 }, () => 'rank suggest').join(' '))), /Already off/, 'repeats count once');

  // Categories bring every command in them, except the ones that always stay on.
  out = text(await dc('category:fun #cmds'));
  assert.match(out, /`8ball` · `roll`/);
  assert.ok(saved().includes('roll@cmds') && saved().includes('8ball@cmds'));
  assert.match(text(await dc('category:nope')), /don't know these commands: `category:nope`/);

  // The list, grouped by channel with counts; and only what applies in one channel.
  reply = await dc('list');
  out = text(reply);
  assert.match(out, /### Disabled commands \(9\)\\nTest/, 'the old header: the title with the count, the server name under it');
  assert.ok([undefined, 0xa5ea7a, 0xfe6465].includes(accent(reply)), 'the list has no colored side bar (not the purple of the other lists)');
  assert.match(out, /The whole server\*\* · 2 commands\\n`rank` · `suggest`/);
  assert.match(out, /<#700000000000000001> · 3 commands/);
  assert.match(out, /<#700000000000000002> · 2 commands/);
  assert.ok(out.indexOf('The whole server') < out.indexOf('<#700000000000000001>'), 'the server-wide group comes first');
  out = text(await dc('#memes'));
  assert.match(out, /<#700000000000000002> · 2 commands/);
  assert.ok(!out.includes('<#700000000000000001>'), 'only the rules that apply in that channel');

  // Enable: in one channel, everywhere, a rule that is not there, and the server-wide rule that still applies.
  out = text(await dc('enable suggest #cmds'));
  assert.match(out, /Back on in <#700000000000000001>/);
  assert.match(out, /Still off on the whole server: `suggest`/);
  out = text(await dc('remove rank'));
  assert.match(out, /Back on everywhere/);
  assert.ok(!saved().some((rule) => rule.startsWith('rank@')), 'without a channel every rule of the command goes');
  assert.match(text(await dc('enable rank')), /These were not disabled: `rank`/);

  // Clear one channel, then everything.
  out = text(await dc('clear #cmds'));
  assert.match(out, /Removed 2 rules from <#700000000000000001>/);
  assert.match(text(await dc('clear #cmds')), /Nothing is disabled in <#700000000000000001>/);
  out = text(await dc('enable all'));
  assert.match(out, /every command works again/);
  assert.deepEqual(saved(), []);
  reply = await dc('list');
  assert.match(text(reply), /No commands are disabled/);
  assert.ok([undefined, 0xa5ea7a, 0xfe6465].includes(accent(reply)), 'the empty list has no color either');

  // Spanish and Portuguese.
  assert.match(text(await dc('suggest #cmds', 'es')), /Desactivados en <#700000000000000001>/);
  assert.match(text(await dc('nothing', 'pt-BR')), /Não conheço estes comandos: `nothing`/);
  assert.match(text(await dc('list', 'es')), /Comandos desactivados \(1\)/);
  assert.match(text(await dc('enable all', 'pt-BR')), /1 regra removida/);

  // The other lists of the pager keep their purple; only !dc asks for none.
  const pager = require('../src/utils/pager');
  pager.register('dc-check-colored', { load: async () => ({ title: 'x', items: ['a'] }) });
  assert.equal((await pager.buildPage('dc-check-colored', { guild, userId: '9', lang: 'en' })).components[0].toJSON().accent_color, undefined, 'a list has no color');

  // The notice a member sees, prefix and slash: short, with the command and the channel, and no colored side bar.
  const { t } = require('../src/i18n');
  assert.match(t('en', 'core.disabled.channel', { emoji: 'x', command: '!suggest', channel: '<#1>' }), /`!suggest` is turned off in <#1>/);
  assert.match(t('es', 'core.disabled.server', { emoji: 'x', command: '/rank' }), /`\/rank` está desactivado en este servidor/);
  const fs = require('node:fs');
  const events = fs.readFileSync(path.join(__dirname, '../src/events/messageCreateCommands.js'), 'utf8');
  assert.match(events, /core\.disabled\.channel[\s\S]{0,400}warningPayload\(message, text\.trim\(\), null\)[\s\S]{0,200}setTimeout\(\(\) => notice\.delete/, 'the prefix notice is the warning card with no color, and it deletes itself');
  assert.ok(!/core\.disabled[\s\S]{0,600}COLORS\.RED/.test(events), 'no red bar on the prefix notice');
  const slash = fs.readFileSync(path.join(__dirname, '../src/events/interactionCreate.js'), 'utf8');
  assert.match(slash, /core\.disabled\.channel[\s\S]{0,400}textCard\(text, null\)[\s\S]{0,80}MessageFlags\.Ephemeral \| MessageFlags\.IsComponentsV2/, 'the slash notice is private and has no color');
  const { textCard } = require('../src/utils/caseCard');
  assert.equal(textCard('x', null).toJSON().accent_color, undefined);
  const { noticePayload } = require('../src/utils/infoCard');
  assert.equal(noticePayload('x', null).components[0].toJSON().accent_color, undefined, 'noticePayload can draw a card with no color');

  console.log('disablecommand ok');
})().catch((error) => { console.error(error); process.exit(1); });
