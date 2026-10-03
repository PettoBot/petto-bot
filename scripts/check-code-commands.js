// Checks custom commands written in code: who can write them, what a message of code can do and what is held back (roles,
// channels, pings), the cooldown, mistakes in the code, extracting code from a message, share codes and the templates.
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits, Collection } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const settings = { ownerId: 'owner', developerIds: ['dev'], codeCommandTesterIds: ['tester'], codeCommandsPublic: false };
stub('src/config.js', settings);
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => String(text).match(/"[^"]*"|\S+/g)?.map((word) => word.replace(/^"|"$/g, '')) ?? [] });
const store = new Map();
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/embedTemplates.js', { getTemplate: async () => null });
stub('src/db/customCommands.js', {
  normalizeName: (name) => name.toLowerCase().trim().replace(/\s+/g, ''),
  getCommand: async (guildId, name) => store.get(`${guildId}:${name}`) ?? null,
  upsertCommand: async (guildId, name, values) => { store.set(`${guildId}:${name}`, { name, ...values, code: values.code ?? null, created_by: values.createdBy }); return store.get(`${guildId}:${name}`); },
  removeCommand: async () => true,
  listCommands: async (guildId) => [...store.entries()].filter(([key]) => key.startsWith(`${guildId}:`)).map(([, value]) => value),
});
stub('src/utils/caseCard.js', { textCard: (text) => ({ text }) });
const memoryData = new Map();
stub('src/db/commandData.js', { forGuild: () => ({ async get(key, user) { return memoryData.get(`${user}|${key}`) ?? null; }, async set(key, value, user) { memoryData.set(`${user}|${key}`, value); }, async del() {}, async incr(key, amount, user) { const next = (memoryData.get(`${user}|${key}`) ?? 0) + amount; memoryData.set(`${user}|${key}`, next); return next; }, async top() { return []; }, async keys() { return []; } }) });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/colors.js', { COLORS: { DEFAULT: 1, RED: 2, GREEN: 3 } });
const codeCommands = require('../src/utils/codeCommands');
const { TEMPLATES } = require('../src/scripting/templates');
const { run, check } = require('../src/scripting');

// Who can write code.
assert.equal(codeCommands.canWriteCode('owner') && codeCommands.canWriteCode('dev') && codeCommands.canWriteCode('tester'), true);
assert.equal(codeCommands.canWriteCode('someone'), false);
settings.codeCommandsPublic = true; assert.equal(codeCommands.canWriteCode('someone'), true); settings.codeCommandsPublic = false;

// Taking the code out of what was typed.
assert.equal(codeCommands.extractCode('```\n{{ .User.ID }}\n```'), '{{ .User.ID }}');
assert.equal(codeCommands.extractCode('```js\nline 1\nline 2\n```'), 'line 1\nline 2');
assert.equal(codeCommands.extractCode('`{{ 1 }}`'), '{{ 1 }}');
assert.equal(codeCommands.extractCode('  plain {{ 1 }} '), 'plain {{ 1 }}');
assert.equal(codeCommands.rawAfter('!cc code roll ```\nline 1\n\n  line 2\n```', 1), '```\nline 1\n\n  line 2\n```', 'the lines are kept as they were typed');
assert.equal(codeCommands.rawAfter('!cc codetest {{ 1 }}   x', 0), '{{ 1 }}   x');
assert.equal(codeCommands.rawAfter('<@999> cc code roll hi there', 1), 'hi there', 'a mention as the prefix');
assert.equal(codeCommands.rawAfter('!cc code', 1), '');

// Share codes.
const share = codeCommands.encodeShare({ name: 'roll', description: 'dice', code: '{{ randInt 6 }}' });
assert.ok(share.startsWith('pc1.'));
assert.deepEqual(codeCommands.decodeShare(share), { name: 'roll', description: 'dice', code: '{{ randInt 6 }}' });
assert.throws(() => codeCommands.decodeShare('p1.abc'), /starts with pc1/);
assert.throws(() => codeCommands.decodeShare('pc1.!!!'), /damaged|not one of/);
assert.throws(() => codeCommands.decodeShare(`pc1.${Buffer.from(JSON.stringify({ v: 2, c: 'x' })).toString('base64url')}`), /not one of/);
assert.equal(codeCommands.decodeShare(codeCommands.encodeShare({ name: 'Bad Name!', code: 'x' })).name, 'badname', 'a name from a share code is cleaned');

// Fakes of the bot, the server and the message.
const ME = 'bot';
const permissions = (flags) => ({ has: (flag) => flags === 'all' || flags.includes(flag) });
const makeGuild = () => {
  const roles = new Collection();
  const addRole = (id, { position = 1, permissions: perms = [], managed = false, mentionable = false } = {}) => roles.set(id, { id, position, managed, mentionable, permissions: { has: (flag) => perms.includes(flag) } });
  addRole('100000000000000001', { position: 2 }); // a plain role
  addRole('100000000000000002', { position: 2, permissions: [PermissionFlagsBits.BanMembers] }); // a risky one
  addRole('100000000000000003', { position: 50 }); // above the bot
  addRole('100000000000000004', { position: 2, managed: true });
  addRole('100000000000000005', { position: 2, mentionable: true });
  const sent = [];
  const channels = new Collection();
  const makeChannel = (id, { botCan = 'all', memberCan = 'all' } = {}) => channels.set(id, {
    id, name: `chan${id.slice(-1)}`, isTextBased: () => true, isDMBased: () => false,
    permissionsFor: (who) => permissions(who === 'ME' ? botCan : memberCan),
    send: async (payload) => { sent.push({ channel: id, payload }); },
  });
  makeChannel('200000000000000001');
  makeChannel('200000000000000002', { botCan: [PermissionFlagsBits.ViewChannel] }); // the bot cannot send
  makeChannel('200000000000000003', { memberCan: [] }); // the member cannot send
  const me = { permissions: permissions('all'), roles: { highest: { position: 10 } }, permissionsIn: () => permissions('all') };
  const guild = { id: '300000000000000001', name: 'HQ', memberCount: 90, iconURL: () => null, roles: { cache: roles }, channels: { cache: channels }, members: { me } };
  return { guild, sent, channels };
};
function makeMessage({ guildBits = makeGuild(), content = '!x', memberRoles = [] } = {}) {
  const { guild, sent, channels } = guildBits;
  const replies = []; const dms = []; const reactions = []; const roleLog = []; let deleted = false;
  const channel = channels.get('200000000000000001');
  const member = {
    nickname: null, displayName: 'Liam', joinedTimestamp: 1_700_000_000_000, roles: { cache: new Collection([...memberRoles.map((id) => [id, { id }])]), add: async (role) => roleLog.push(['add', role.id]), remove: async (role) => roleLog.push(['remove', role.id]) },
  };
  // permissionsFor is called with the bot (guild.members.me) or the member: tell them apart.
  for (const ch of channels.values()) { const original = ch.permissionsFor; ch.permissionsFor = (who) => original(who === guild.members.me ? 'ME' : 'MEMBER'); }
  const message = {
    id: '400000000000000001', content, url: 'https://discord.com/x', guild, channel, member,
    author: { id: '500000000000000001', username: 'Liam', globalName: null, bot: false, displayAvatarURL: () => 'https://cdn.example/a.png', send: async (payload) => { dms.push(payload); } },
    reply: async (payload) => { replies.push(payload); },
    react: async (emoji) => { reactions.push(emoji); },
    delete: async () => { deleted = true; },
  };
  return { message, replies, dms, reactions, roleLog, sent, isDeleted: () => deleted };
}
const row = (code, name = `c${Math.random().toString(16).slice(2, 8)}`) => ({ name, code });

(async () => {
  // Data the code reads.
  const data = codeCommands.buildData(makeMessage().message, 'x', 'a "b c" d', '!');
  assert.deepEqual([data.User.Username, data.Guild.Name, data.Channel.Mention, data.Cmd, data.Prefix, data.RawArgs], ['Liam', 'HQ', '<#200000000000000001>', 'x', '!', 'a "b c" d']);
  assert.deepEqual(data.Args, ['a', 'b c', 'd']);
  assert.equal(data.Member.JoinedAt, 1_700_000_000);

  // Text and a message.
  let t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('Hello {{ .User.Username }}! {{ sendMessage nil (cembed "title" "T") }}'), '', '!');
  assert.equal(t.replies[0].content, 'Hello Liam!');
  assert.equal(t.sent[0].payload.embeds[0].data.title, 'T');
  assert.deepEqual(t.replies[0].allowedMentions.parse, [], 'nothing is pinged by itself');

  // Pings: only what the code mentions on purpose, and a role only if it can be mentioned.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ mentionUser "600000000000000009" }} {{ mentionRole "100000000000000005" }} {{ mentionRole "100000000000000001" }} @everyone @here'), '', '!');
  assert.deepEqual(t.replies[0].allowedMentions.users.sort(), ['500000000000000001', '600000000000000009']);
  assert.deepEqual(t.replies[0].allowedMentions.roles, ['100000000000000005'], 'a role that cannot be mentioned is not pinged');
  assert.deepEqual(t.replies[0].allowedMentions.parse, [], '@everyone and @here never ping');

  // Other channels: where Petto or the member cannot send, it is not done.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ sendMessage "200000000000000002" "a" }}{{ sendMessage "200000000000000003" "b" }}{{ sendMessage "999999999999999999" "c" }}{{ sendMessage "200000000000000001" "ok" }}'), '', '!');
  assert.deepEqual(t.sent.map((entry) => entry.payload.content), ['ok']);
  assert.ok(t.replies.at(-1).content.includes('Petto cannot send there') && t.replies.at(-1).content.includes('you cannot send there') && t.replies.at(-1).content.includes('not in this server'));

  // Roles: only plain roles below Petto.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ addRole "100000000000000001" }}{{ addRole "100000000000000002" }}{{ addRole "100000000000000003" }}{{ addRole "100000000000000004" }}{{ removeRole "100000000000000001" }}{{ addRole "199999999999999999" }}'), '', '!');
  assert.deepEqual(t.roleLog, [['add', '100000000000000001'], ['remove', '100000000000000001']]);
  const skipped = t.replies.at(-1).content;
  assert.ok(skipped.includes('moderation or server permissions') && skipped.includes('above Petto') && skipped.includes('cannot be given') && skipped.includes('does not exist'), skipped);

  // Direct message, reaction and deleting the trigger.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ sendDM "psst" }}{{ addReaction "👍" }}{{ deleteTrigger }}done'), '', '!');
  assert.equal(t.dms[0].content, 'psst'); assert.deepEqual(t.reactions, ['👍']); assert.equal(t.isDeleted(), true);
  assert.deepEqual(t.dms[0].allowedMentions, { parse: [] });

  // A long text is cut to Discord's limit.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ range seq 0 100 }}0123456789012345678901234567890123456789{{ end }}'), '', '!');
  assert.equal(t.replies[0].content.length, 2000);

  // Mistakes in the code are told, not thrown.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ nope 1 }}'), '', '!');
  assert.ok(t.replies[0].content.includes('no function called "nope"') && t.replies[0].content.includes('A server admin can fix it'));
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ range seq 0 1000 }}{{ range seq 0 1000 }}x{{ end }}{{ end }}'), '', '!');
  assert.ok(t.replies[0].content.includes('mistake'), 'a limit is told too');

  // Cooldown: the same person and command, twice in a row, runs once.
  t = makeMessage();
  const same = row('x', 'cool');
  await codeCommands.runCodeCommand(t.message, same, '', '!'); await codeCommands.runCodeCommand(t.message, same, '', '!');
  assert.equal(t.replies.length, 1, 'the second use inside the cooldown is ignored');

  // Data stored by a command is kept between uses and between members; a test never keeps it.
  t = makeMessage();
  const counter = row('{{ dbIncr "uses" 1 }} uses', 'counter');
  await codeCommands.runCodeCommand(t.message, counter, '', '!');
  const t2 = makeMessage();
  t2.message.author.id = '500000000000000002';
  await codeCommands.runCodeCommand(t2.message, row('{{ dbIncr "uses" 1 }} uses', 'counter2'), '', '!');
  assert.deepEqual([t.replies[0].content, t2.replies[0].content], ['1 uses', '2 uses'], 'what a command stores is kept for the next use');

  // The arguments reach the code.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ add (index .Args 0) (index .Args 1) }}'), '4 5', '!');
  assert.equal(t.replies[0].content, '9');

  // Every template is valid and runs, alone and with no arguments.
  const base = codeCommands.buildData(makeMessage().message, 'x', '', '!');
  assert.ok(TEMPLATES.length >= 8);
  const ids = new Set();
  for (const template of TEMPLATES) {
    assert.ok(!ids.has(template.id), `template id ${template.id} is not repeated`); ids.add(template.id);
    assert.equal(check(template.code), null, `${template.id} is valid`);
    for (const args of [[], ['20'], ['a', 'b', 'c']]) {
      const result = await run(template.code, { ...base, Args: args, RawArgs: args.join(' ') }, { random: () => 0.5 });
      assert.ok(result.output.trim() || result.effects.length, `${template.id} does something with ${args.length} arguments`);
    }
    assert.match(template.suggestedName, /^[a-z0-9_-]{1,32}$/);
    assert.ok(template.description.length > 5);
  }

  // The command that writes them.
  const command = require('../src/commands/automation/customcommand');
  const fakeInteraction = (sub, options, content, userId = 'tester') => {
    const m = makeMessage({ content });
    const out = [];
    return {
      out, m, guild: m.message.guild, user: { id: userId }, channel: { send: async (payload) => { out.push({ file: payload }); } }, rawMessage: m.message,
      client: { commands: new Map([['ping', {}]]), commandAliases: new Map(), commandRoutes: new Map() },
      options: { getSubcommand: () => sub, getString: (name, required) => { const value = options[name] ?? null; if (required && value === null) throw new Error(`missing ${name}`); return value; } },
      deferReply: async () => {}, editReply: async (payload) => { out.push(payload); },
    };
  };
  const say = async (interaction) => { await command.execute(interaction); return interaction.out.map((o) => o.components?.[0]?.text ?? o.file?.content ?? '').join('\n'); };

  assert.ok((await say(fakeInteraction('template', {}, '!cc template', 'someone'))).includes('only available to Petto'), 'someone who is not in the team is told it is in testing');
  const listed = await say(fakeInteraction('template', {}, '!cc template'));
  assert.ok(TEMPLATES.every((template) => listed.includes(`\`${template.id}\``)), 'every template is listed');
  assert.ok((await say(fakeInteraction('template', { id: 'roll' }, '!cc template roll'))).includes('created from the template'));
  assert.ok(store.get('300000000000000001:roll').code.includes('randInt'), 'the template is saved as code');
  assert.ok((await say(fakeInteraction('template', { id: 'nope' }, '!cc template nope'))).includes('no template called'));
  assert.ok((await say(fakeInteraction('template', { id: 'roll', name: 'ping' }, '!cc template roll ping'))).includes('already a real command'), 'a real command name cannot be taken');
  assert.ok((await say(fakeInteraction('template', { id: 'roll', name: 'Bad Name!' }, '!cc template roll Bad Name!'))).includes('1 to 32'), 'a name is checked');

  assert.ok((await say(fakeInteraction('code', { name: 'greet' }, '!cc code greet ```\nHi {{ .User.Username }}\n\nBye\n```'))).includes('created'));
  assert.equal(store.get('300000000000000001:greet').code, 'Hi {{ .User.Username }}\n\nBye', 'the lines of the code are kept');
  assert.equal(store.get('300000000000000001:greet').created_by, 'tester');
  assert.ok((await say(fakeInteraction('code', { name: 'greet' }, '!cc code greet new {{ 1 }}'))).includes('updated'));
  const broken = await say(fakeInteraction('code', { name: 'bad' }, '!cc code bad a\n{{ if }}x{{ end }}'));
  assert.ok(broken.includes('mistake') && broken.includes('line 2'), broken);
  assert.equal(store.has('300000000000000001:bad'), false, 'code with a mistake is not saved');
  assert.ok((await say(fakeInteraction('code', { name: 'empty' }, '!cc code empty'))).includes('There is no code'));
  assert.ok((await say(fakeInteraction('code', { name: 'big' }, `!cc code big ${'x'.repeat(10_001)}`))).includes('too long'));

  const test = fakeInteraction('codetest', {}, '!cc codetest ```\nHi {{ .User.Username }}{{ sendMessage nil "x" }}{{ addRole "100000000000000001" }}\n```');
  const tested = await say(test);
  assert.ok(tested.includes('It would print') && tested.includes('Hi Liam') && tested.includes('send "x" here') && tested.includes('give the role'), tested);
  assert.equal(test.m.sent.length, 0, 'a test sends nothing'); assert.equal(test.m.roleLog.length, 0, 'a test changes nothing');
  assert.ok((await say(fakeInteraction('codetest', {}, '!cc codetest {{ boom }}'))).includes('The code stopped'));
  const first = await say(fakeInteraction('codetest', {}, '!cc codetest {{ dbIncr "t" 5 }}{{ dbIncr "t" 5 }}'));
  assert.ok(first.includes('10'), 'inside a test, what is stored lasts the whole run');
  assert.equal(memoryData.has('|t'), false, 'but a test never stores anything for real');
  assert.ok((await say(fakeInteraction('codetest', {}, '!cc codetest {{ dbGet "t" }}'))).includes('_nothing_'), 'and the next test starts empty');
  assert.ok((await say(fakeInteraction('codetest', {}, '!cc codetest {{ add 1 "x" }}'))).includes('stopped'));

  const exported = await say(fakeInteraction('export', { name: 'greet' }, '!cc export greet'));
  const code = /pc1\.[A-Za-z0-9_-]+/.exec(exported)[0];
  assert.ok((await say(fakeInteraction('import', { share: code, name: 'copy' }, `!cc import ${code} copy`))).includes('imported'));
  assert.equal(store.get('300000000000000001:copy').code, store.get('300000000000000001:greet').code, 'an import gives the same code');
  assert.ok((await say(fakeInteraction('import', { share: 'pc1.zzz' }, '!cc import pc1.zzz'))).length > 0);
  assert.ok((await say(fakeInteraction('codeshow', { name: 'greet' }, '!cc codeshow greet'))).includes('new {{ 1 }}'));
  assert.ok((await say(fakeInteraction('codeshow', { name: 'nope' }, '!cc codeshow nope'))).includes('does not exist'));
  // A long code goes in a file.
  store.set('300000000000000001:long', { name: 'long', code: `{{/* ${'x'.repeat(2000)} */}}` });
  const longShown = fakeInteraction('codeshow', { name: 'long' }, '!cc codeshow long');
  assert.ok((await say(longShown)).includes('is long, so it is in this file'));

  console.log('Checked the custom commands in code: who writes them, what they may do, the limits of pings, roles and channels, share codes and the templates.');
})().catch((error) => { console.error(error); process.exit(1); });
