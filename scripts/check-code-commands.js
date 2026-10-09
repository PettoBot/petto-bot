// Checks custom commands written in code: who can write them, what a message of code can do and what is held back (roles,
// channels, pings), the cooldown, mistakes in the code, extracting code from a message, share codes and the templates.
const assert = require('node:assert/strict');
const path = require('node:path');
const { PermissionFlagsBits, Collection, MessageFlags } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const settings = { ownerId: 'owner', developerIds: ['dev'], codeCommandsDisabled: false };
stub('src/config.js', settings);
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => String(text).match(/"[^"]*"|\S+/g)?.map((word) => word.replace(/^"|"$/g, '')) ?? [] });
const store = new Map();
stub('src/db/guilds.js', { ensureGuild: async () => {} });
stub('src/db/premium.js', { getGuildPremium: async () => ({ active: false }), getGuildLimits: (premium) => ({ customCommands: premium?.active ? 100 : 50 }) });
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
const watching = new Map();
const reactionLog = [];
stub('src/db/commandData.js', { forGuild: () => ({ async get(key, user) { return memoryData.get(`${user}|${key}`) ?? null; }, async set(key, value, user) { memoryData.set(`${user}|${key}`, value); }, async del() {}, async incr(key, amount, user) { const next = (memoryData.get(`${user}|${key}`) ?? 0) + amount; memoryData.set(`${user}|${key}`, next); return next; }, async top() { return []; }, async keys() { return []; }, async watch(id, record) { watching.set(id, record); }, async watched(id) { return watching.get(id) ?? null; } }) });
stub('src/utils/emojis.js', { EMOJI: { APPROVE: 'OK', DENY: 'NO' } });
stub('src/utils/colors.js', { COLORS: { DEFAULT: 1, RED: 2, GREEN: 3 } });
const codeCommands = require('../src/utils/codeCommands');
const { TEMPLATES } = require('../src/scripting/templates');
const { run, check } = require('../src/scripting');

// Who can write code: everyone, until it is turned off.
assert.equal(codeCommands.canWriteCode(), true);
settings.codeCommandsDisabled = true; assert.equal(codeCommands.canWriteCode(), false); settings.codeCommandsDisabled = false;

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
    send: async (payload) => { sent.push({ channel: id, payload }); return { id: `9000${sent.length}`, react: async (emoji) => { reactionLog.push({ emoji, watchedAlready: watching.size > 0 }); } }; },
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

  // A delay leaves the trigger for later, "reply" answers the message itself and "silent" sends without a notification.
  t = makeMessage();
  await codeCommands.runCodeCommand(t.message, row('{{ deleteTrigger 30 }}{{ sendMessage nil (complexMessage "content" "r" "reply" true) }}{{ sendMessage nil (complexMessage "content" "s" "silent" true) }}'), '', '!');
  assert.equal(t.isDeleted(), false, 'deleting with a delay waits');
  assert.equal(t.replies[0].content, 'r', 'reply answers the message that used the command');
  assert.equal(t.sent[0].payload.content, 's');
  assert.equal(t.sent[0].payload.flags, MessageFlags.SuppressNotifications, 'silent sends without a notification');

  // The new data: who and what was mentioned, the server prefix, the time and more about the server, the member and the channel.
  {
    const m = makeMessage();
    m.message.mentions = { users: new Collection([['600000000000000009', { id: '600000000000000009', username: 'Santi', globalName: 'Santi', bot: false, displayAvatarURL: () => 'https://cdn.example/s.png' }]]), members: new Collection(), roles: new Collection([['100000000000000005', {}]]), channels: new Collection() };
    m.message.attachments = new Collection([['1', { url: 'https://cdn.example/f.png', name: 'f.png', size: 10, contentType: 'image/png' }]]);
    m.message.guild.ownerId = '500000000000000001';
    const d = codeCommands.buildData(m.message, 'x', '', '?', '!');
    assert.equal(d.Mentions[0].Mention, '<@600000000000000009>');
    assert.deepEqual(d.MentionedRoles, ['100000000000000005']);
    assert.equal(d.Message.Attachments[0].Name, 'f.png');
    assert.equal(d.Prefix, '?'); assert.equal(d.ServerPrefix, '!');
    assert.equal(d.Member.IsOwner, true);
    assert.equal(d.Message.CommandUserID, '500000000000000001', 'a typed command was used by its author');
    assert.ok(d.User.CreatedAt > 1_420_070_400 && d.Now > 1_700_000_000);
    const lookup = codeCommands.lookupFor(m.message.guild);
    assert.equal((await lookup.role('100000000000000005')).Mentionable, true);
    assert.equal((await lookup.channel('200000000000000001')).Mention, '<#200000000000000001>');
    assert.equal(await lookup.member('600000000000000009'), null, 'a member that cannot be read is nil');
    const ran = await run('{{ (getRole "<@&100000000000000005>").ID }} {{ getChannel "999999999999999999" }}', d, { lookup });
    assert.equal(ran.output, '100000000000000005 ');
  }

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

  // Buttons and menus: the id Discord keeps, and running a command because of a click.
  const sample = { handler: 'yes', data: 'a1', userId: '123456789012345678' };
  assert.equal(codeCommands.componentId('vote', sample), 'cc:vote:yes:a1:u123456789012345678');
  assert.deepEqual(codeCommands.parseComponentId('cc:vote:yes:a1:u123456789012345678'), { command: 'vote', handler: 'yes', data: 'a1', userId: '123456789012345678' });
  assert.deepEqual(codeCommands.parseComponentId('cc:vote:yes::'), { command: 'vote', handler: 'yes', data: '', userId: null });
  assert.equal(codeCommands.parseComponentId('quests:view'), null); assert.equal(codeCommands.parseComponentId('cc:only:three'), null);
  assert.ok(codeCommands.componentId('x'.repeat(32), { handler: 'h'.repeat(20), data: 'd'.repeat(20), userId: '123456789012345678' }).length <= 100, 'the longest id fits the 100 characters of Discord');

  const realNow = Date.now; let clock = realNow(); Date.now = () => clock;
  const voteTemplate = TEMPLATES.find((template) => template.id === 'vote');
  const voteRow = { name: 'vote', code: voteTemplate.code };
  const bits = makeGuild();
  const asked = makeMessage({ guildBits: bits, content: '!vote pizza?' });
  await codeCommands.runCodeCommand(asked.message, voteRow, 'pizza tonight?', '!');
  const sentVote = bits.sent[0].payload;
  assert.equal(sentVote.embeds[0].data.description, 'pizza tonight?');
  const buttonIds = sentVote.components[0].components.map((button) => button.data.custom_id);
  assert.deepEqual(buttonIds, ['cc:vote:yes::', 'cc:vote:no::'], 'the buttons carry the command and the handler');

  const click = async (customId, { user = '500000000000000001', values = null, embeds, advance = 5000 } = {}) => {
    clock += advance;
    const made = makeMessage({ guildBits: bits });
    const log = { replies: [], updates: [], deferred: 0, followUps: [] };
    const interaction = {
      customId, guild: made.message.guild, guildId: made.message.guild.id, channel: made.message.channel, member: made.message.member, user: { ...made.message.author, id: user },
      message: { id: '600000000000000001', content: '', embeds: embeds ?? [{ title: '📊 Vote', description: 'pizza tonight?', footer: { text: 'Yes: 0 · No: 0' } }], url: 'x' },
      isStringSelectMenu: () => values !== null, values: values ?? [],
      reply: async (payload) => { log.replies.push(payload); }, update: async (payload) => { log.updates.push(payload); }, deferUpdate: async () => { log.deferred += 1; }, followUp: async (payload) => { log.followUps.push(payload); },
    };
    await codeCommands.runComponent(interaction, voteRow.name === customId.split(':')[1] ? voteRow : row('x'), codeCommands.parseComponentId(customId));
    return { ...log, made };
  };
  let vote = await click('cc:vote:yes::');
  assert.equal(vote.updates[0].embeds[0].data.footer.text, 'Yes: 1 · No: 0', 'a click updates the message it is on');
  assert.equal(vote.updates[0].embeds[0].data.description, 'pizza tonight?');
  vote = await click('cc:vote:yes::');
  assert.ok(vote.replies[0].content.includes('already voted') && vote.replies[0].flags, 'the same vote again is answered in private');
  vote = await click('cc:vote:no::');
  assert.equal(vote.updates[0].embeds[0].data.footer.text, 'Yes: 0 · No: 1', 'changing a vote moves it');
  vote = await click('cc:vote:yes::', { user: '500000000000000002' });
  assert.equal(vote.updates[0].embeds[0].data.footer.text, 'Yes: 1 · No: 1', 'another member adds a vote');

  // A locked button is only for who it names.
  const locked = await click('cc:vote:yes::u500000000000000009');
  assert.ok(locked.replies[0].content.includes('not for you') && locked.updates.length === 0);
  // A click right after another one of the same button is held back, without a message.
  await click('cc:vote:yes::', { user: '500000000000000003' });
  const quick = await click('cc:vote:yes::', { user: '500000000000000003', advance: 0 });
  assert.equal(quick.deferred, 1); assert.equal(quick.updates.length + quick.replies.length, 0, 'a click right after another is held back without a message');
  // Menus: the values reach the code, and respond can be private.
  const favoriteRow = { name: 'favorite', code: TEMPLATES.find((template) => template.id === 'favorite').code };
  const menuClick = async (values) => {
    clock += 5000;
    const made = makeMessage({ guildBits: bits }); const log = { replies: [], updates: [], deferred: 0 };
    await codeCommands.runComponent({
      guild: made.message.guild, guildId: made.message.guild.id, channel: made.message.channel, member: made.message.member, user: made.message.author, message: { id: '1', content: '', embeds: [] },
      isStringSelectMenu: () => true, values, reply: async (payload) => { log.replies.push(payload); }, update: async (payload) => { log.updates.push(payload); }, deferUpdate: async () => { log.deferred += 1; }, followUp: async () => {},
    }, favoriteRow, { command: 'favorite', handler: 'pick', data: '', userId: null });
    return log;
  };
  const picked = await menuClick(['sushi']);
  assert.ok(picked.replies[0].content.includes('**sushi**') && picked.replies[0].flags, 'a menu answers with what was chosen, in private');
  // A click that does nothing is acknowledged without a message.
  const quiet = await (async () => {
    const made = makeMessage({ guildBits: bits }); const log = { deferred: 0, replies: [] }; clock += 5000;
    await codeCommands.runComponent({ guild: made.message.guild, guildId: made.message.guild.id, channel: made.message.channel, member: made.message.member, user: made.message.author, message: { id: '1', content: '', embeds: [] }, isStringSelectMenu: () => false, values: [], reply: async (p) => { log.replies.push(p); }, update: async () => {}, deferUpdate: async () => { log.deferred += 1; }, followUp: async () => {} }, row('{{ $x := 1 }}', 'quiet'), { command: 'quiet', handler: 'h', data: '', userId: null });
    return log;
  })();
  assert.equal(quiet.deferred, 1); assert.equal(quiet.replies.length, 0);
  // The clicker counts for everyone, and what a click does besides answering is held to the same checks.
  const clickerRow = { name: 'clicker', code: TEMPLATES.find((template) => template.id === 'clicker').code };
  const clickerAsked = makeMessage({ guildBits: bits }); await codeCommands.runCodeCommand(clickerAsked.message, clickerRow, '', '!');
  assert.ok(bits.sent.at(-1).payload.content.includes('Clicks: **0**') && bits.sent.at(-1).payload.components.length === 1);
  const roleRow = { name: 'getrole', code: '{{ addRole "100000000000000002" }}{{ addRole "100000000000000001" }}{{ respond "ok" true }}' };
  const roleClick = makeMessage({ guildBits: bits }); const roleLog = { replies: [], followUps: [] }; clock += 5000;
  await codeCommands.runComponent({ guild: roleClick.message.guild, guildId: roleClick.message.guild.id, channel: roleClick.message.channel, member: roleClick.message.member, user: roleClick.message.author, message: { id: '1', content: '', embeds: [] }, isStringSelectMenu: () => false, values: [], reply: async (p) => { roleLog.replies.push(p); }, update: async () => {}, deferUpdate: async () => {}, followUp: async (p) => { roleLog.followUps.push(p); } }, roleRow, { command: 'getrole', handler: 'h', data: '', userId: null });
  assert.deepEqual(roleClick.roleLog, [['add', '100000000000000001']], 'a button cannot give a role with moderation permissions either');
  assert.ok(roleLog.followUps[0].content.includes('moderation or server permissions'), 'and says so in private');
  // A mistake in the code is told in private.
  const brokenClick = makeMessage({ guildBits: bits }); const brokenLog = { replies: [] }; clock += 5000;
  await codeCommands.runComponent({ guild: brokenClick.message.guild, guildId: brokenClick.message.guild.id, channel: brokenClick.message.channel, member: brokenClick.message.member, user: brokenClick.message.author, message: { id: '1', content: '', embeds: [] }, isStringSelectMenu: () => false, values: [], reply: async (p) => { brokenLog.replies.push(p); }, update: async () => {}, deferUpdate: async () => {}, followUp: async () => {} }, row('{{ nope }}', 'broken'), { command: 'broken', handler: 'h', data: '', userId: null });
  assert.ok(brokenLog.replies[0].content.includes('mistake') && brokenLog.replies[0].flags);
  // Modals: a button opens a form, and sending it runs the command again with the fields.
  const suggestRow = { name: 'suggest', code: TEMPLATES.find((template) => template.id === 'suggest').code };
  const formClick = async () => {
    clock += 5000;
    const made = makeMessage({ guildBits: bits }); const log = { modals: [], replies: [] };
    await codeCommands.runComponent({
      customId: 'cc:suggest:open::', guild: made.message.guild, guildId: made.message.guild.id, channel: made.message.channel, member: made.message.member, user: made.message.author,
      message: { id: '600000000000000002', content: '', embeds: [], url: 'x' }, isStringSelectMenu: () => false, isModalSubmit: () => false,
      showModal: async (modal) => { log.modals.push(modal.toJSON()); }, reply: async (payload) => { log.replies.push(payload); }, deferUpdate: async () => {},
    }, suggestRow, codeCommands.parseComponentId('cc:suggest:open::'));
    return log;
  };
  const opened = await formClick();
  assert.equal(opened.modals.length, 1, 'a button can open a modal');
  assert.equal(opened.modals[0].custom_id, 'cc:suggest:send::', 'the modal carries the command and its handler');
  assert.equal(opened.modals[0].title, 'Your suggestion');
  assert.deepEqual(opened.modals[0].components.map((row) => row.components[0].custom_id), ['title', 'details']);
  assert.equal(opened.modals[0].components[1].components[0].required, false);
  clock += 5000;
  const formBits = makeGuild();
  const formMade = makeMessage({ guildBits: formBits });
  const submitLog = { replies: [], updates: [] };
  await codeCommands.runComponent({
    customId: 'cc:suggest:send::', guild: formMade.message.guild, guildId: formMade.message.guild.id, channel: formMade.message.channel, member: formMade.message.member, user: formMade.message.author,
    isStringSelectMenu: () => false, isModalSubmit: () => true, isFromMessage: () => false,
    fields: { fields: new Collection([['title', { customId: 'title', value: 'More music' }], ['details', { customId: 'details', value: '' }]]) },
    reply: async (payload) => { submitLog.replies.push(payload); }, update: async (payload) => { submitLog.updates.push(payload); }, deferUpdate: async () => {},
  }, suggestRow, codeCommands.parseComponentId('cc:suggest:send::'));
  assert.equal(submitLog.replies.length, 1, 'sending the modal is answered');
  assert.ok(submitLog.replies[0].content.includes('Thank you') && submitLog.replies[0].flags, 'in private');
  assert.equal(formBits.sent[0].payload.embeds[0].data.title, '💡 More music', 'the fields reach the code');

  // The embeds of a message give their author, thumbnail, image and color, so code can rebuild one.
  const embedData = codeCommands.buildData({ ...makeMessage().message, embeds: [{ title: 'T', description: 'D', footer: { text: 'F' }, author: { name: 'A', iconURL: 'https://x/a.png' }, thumbnail: { url: 'https://x/t.png' }, image: { url: 'https://x/i.png' }, color: 16764389 }] }, 'x', '', '!');
  assert.deepEqual(embedData.Message.Embeds[0], { Title: 'T', Description: 'D', Footer: 'F', Author: 'A', AuthorIcon: 'https://x/a.png', FooterIcon: null, Thumbnail: 'https://x/t.png', Image: 'https://x/i.png', Color: 16764389 });

  // Reactions: a message sent with "reactions" is watched, and reacting to it runs the command.
  const reactCode = `{{ if eq .Trigger "command" }}{{ sendMessage nil (complexMessage "embed" (cembed "description" "Claim it") "reactions" (cslice "🦋" "🎀")) }}{{ return }}{{ end }}
{{ if eq .Reaction.Emoji "🦋" }}{{ updateMessage (cembed "description" (print "Claimed by " .User.Username)) }}{{ addRole "223456789012345678" }}{{ removeReaction }}{{ else }}{{ respond (print "Thanks " .User.Username) }}{{ end }}`;
  const reactRow = { name: 'claim', code: reactCode };
  const reactBits = makeGuild();
  const reactAsked = makeMessage({ guildBits: reactBits, content: '!claim' });
  await codeCommands.runCodeCommand(reactAsked.message, reactRow, '', '!');
  assert.equal(reactBits.sent.length, 1, 'the message is sent');
  assert.equal(watching.size, 1, 'the message is watched');
  assert.deepEqual(reactionLog.map((entry) => entry.emoji), ['🦋', '🎀'], 'the reactions are put on the message');
  assert.ok(reactionLog.every((entry) => entry.watchedAlready), 'the message is written down before its reactions go on, so a quick reaction is never missed');
  // The same emoji spelled in different ways is the same emoji.
  assert.equal(codeCommands.matchEmoji(['❤️', '<:lazo:1497795615923634408>'], '❤'), '❤️', 'a variation mark does not matter');
  assert.equal(codeCommands.matchEmoji(['<:lazo:1497795615923634408>'], '<:renamed:1497795615923634408>'), '<:lazo:1497795615923634408>', 'a custom emoji is matched by its id');
  assert.equal(codeCommands.matchEmoji(['🦋'], '🎀'), null);
  assert.ok([...watching.values()].some((record) => record.command === 'claim' && record.emojis.length === 2 && record.user === '500000000000000001'), 'the emojis, the command and who used it are remembered');
  const edits = []; const removed = []; const channelSends = []; const roleChanges = [];
  const reactionMessage = {
    id: 'm1', content: '', url: 'x', embeds: [], author: { id: 'bot' }, guild: reactAsked.message.guild, channel: { ...reactAsked.message.channel, send: async (payload) => { channelSends.push(payload); }, permissionsFor: () => ({ has: () => true }) },
    edit: async (payload) => { edits.push(payload); }, react: async () => {}, delete: async () => {},
  };
  reactionMessage.guild.members.me ??= { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 10 } }, permissionsIn: () => ({ has: () => true }) };
  reactionMessage.author = { id: reactionMessage.guild.members.me.id };
  reactionMessage.guild.members.cache = new Collection();
  reactionMessage.guild.members.fetch = async () => reactAsked.message.member;
  const fakeReaction = { message: reactionMessage, users: { remove: async (id) => { removed.push(id); } } };
  clock += 5000;
  await codeCommands.runReaction(fakeReaction, { id: reactAsked.message.author.id, username: 'Liam', bot: false }, reactRow, '🦋');
  assert.equal(edits.length, 1, 'updateMessage changes the message that was reacted to');
  assert.equal(edits[0].embeds[0].data.description, 'Claimed by Liam');
  assert.deepEqual(removed, [reactAsked.message.author.id], 'removeReaction takes the reaction of the person away');
  clock += 5000;
  await codeCommands.runReaction(fakeReaction, { id: reactAsked.message.author.id, username: 'Liam', bot: false }, reactRow, '🎀');
  assert.equal(channelSends.length, 1, 'respond sends a message in the channel');
  assert.equal(channelSends[0].content, 'Thanks Liam');

  Date.now = realNow;

  // Every template is valid and runs, alone and with no arguments.
  const base = codeCommands.buildData(makeMessage().message, 'x', '', '!');
  assert.ok(TEMPLATES.length >= 8);
  const ids = new Set();
  for (const template of TEMPLATES) {
    assert.ok(!ids.has(template.id), `template id ${template.id} is not repeated`); ids.add(template.id);
    assert.equal(check(template.code), null, `${template.id} is valid`);
    for (const args of [[], ['20'], ['a', 'b', 'c']]) {
      const result = await run(template.code, { ...base, Args: args, RawArgs: args.join(' ') }, { random: () => 0.5, store: codeCommands.memoryStore(), lookup: codeCommands.lookupFor(makeMessage().message.guild) });
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
      deferReply: async () => {}, editReply: async (payload) => { out.push(payload); }, reply: async (payload) => { out.push({ page: payload }); },
    };
  };
  const say = async (interaction) => { await command.execute(interaction); return interaction.out.map((o) => o.components?.[0]?.text ?? o.file?.content ?? '').join('\n'); };

  settings.codeCommandsDisabled = true;
  assert.ok((await say(fakeInteraction('template', {}, '!cc template', 'someone'))).includes('turned off'), 'when it is turned off, people are told');
  settings.codeCommandsDisabled = false;
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

  // The test shows each message like Discord would: its text, its embed, its buttons and menus and its reactions.
  const rich = await say(fakeInteraction('codetest', {}, '!cc codetest ```\n{{ $e := cembed "title" "Rules" "description" "Be kind to everyone here" "fields" (cslice (cslice "a" "1") (cslice "b" "2")) "footer" "HQ" }}{{ $b := crow (cbutton "label" "Yes" "id" "yes" "style" "success") (cbutton "emoji" "🎀" "id" "no") }}{{ $m := crow (cselect "id" "pick" "placeholder" "Pick one" "options" (cslice (cslice "Sushi" "s") (cslice "Pizza" "p"))) }}{{ sendMessage nil (complexMessage "content" "Hello there" "embed" $e "components" (cslice $b $m) "reactions" (cslice "🦋" "🎀")) }}\n```'));
  assert.ok(rich.includes('It would print') && rich.includes('It would do'), rich);
  assert.ok(rich.includes('• send "Hello there" and an embed and buttons or menus here'), 'the one line of each action stays');
  assert.ok(rich.includes('↳ Text: Hello there'), rich);
  assert.ok(rich.includes('↳ Embed: **Rules** · "Be kind to everyone here" · 2 fields · footer "HQ"'), rich);
  assert.ok(rich.includes('↳ Buttons: [Yes] [🎀]'), rich);
  assert.ok(rich.includes('↳ Menu: "Pick one" (2 options: Sushi, Pizza)'), rich);
  assert.ok(rich.includes('↳ Reactions: 🦋 🎀'), rich);
  // Arguments after a code block are what the test types after the command; without a block it is all code, as before.
  const withArgs = await say(fakeInteraction('codetest', {}, '!cc codetest ```\n{{ index .Args 1 }}|{{ .RawArgs }}\n``` red "big cat"'));
  assert.ok(withArgs.includes('big cat|red "big cat"') && withArgs.includes('With the arguments: red "big cat"'), withArgs);
  const noArgs = await say(fakeInteraction('codetest', {}, '!cc codetest {{ len .Args }} x'));
  assert.ok(noArgs.includes('0 x') && !noArgs.includes('With the arguments'), noArgs);
  // Hints: names that are most likely mistakes, even in a part of the code that did not run.
  const hinted = await say(fakeInteraction('codetest', {}, '!cc codetest {{ .User.Usrname }}{{ if false }}{{ lowr "x" }}{{ end }}'));
  assert.ok(hinted.includes('Hint: .User.Usrname is not in the data, so it gives nothing. Did you mean .User.Username?'), hinted);
  assert.ok(hinted.includes('Hint: There is no function called "lowr". Did you mean lower?'), hinted);
  const stoppedHint = await say(fakeInteraction('codetest', {}, '!cc codetest {{ .Guild.Nam }}{{ dbget "x" }}'));
  assert.ok(stoppedHint.includes('The code stopped: There is no function called "dbget". Did you mean dbGet?'), stoppedHint);
  assert.ok(stoppedHint.includes('Hint: .Guild.Nam') && stoppedHint.split('dbGet').length === 2, 'the hint of the function that stopped it is not said twice');

  // !cc info: what a command is, how it starts, its size and what its code uses.
  store.set('300000000000000001:vote', { name: 'vote', code: '{{ dbIncr "votes" 1 }}{{ sendMessage nil (complexMessage "content" "Vote" "components" (cslice (crow (cbutton "label" "Yes" "id" "yes"))) "reactions" (cslice "🦋")) }}{{ .User.Nam }}', trigger_type: 'prefix', trigger_text: '.', created_by: '111111111111111111' });
  const info = await say(fakeInteraction('info', { name: 'vote' }, '!cc info vote'));
  assert.ok(info.includes('**Kind:** code') && info.includes('`.vote`') && info.includes(`of 10000 characters`), info);
  assert.ok(info.includes('**Uses:** stored data, buttons, reactions'), info);
  assert.ok(info.includes('`complexMessage`') && info.includes('`dbIncr`') && info.includes('<@111111111111111111>'), info);
  assert.ok(info.includes('Hint: .User.Nam is not in the data'), info);
  store.set('300000000000000001:hello', { name: 'hello', code: null, response: 'Hi {user}', embed_template: 'card' });
  const textInfo = await say(fakeInteraction('info', { name: 'hello' }, '!cc info hello'));
  assert.ok(textInfo.includes('**Kind:** text') && textInfo.includes('9 characters') && textInfo.includes('`card`') && textInfo.includes('`!hello`'), textInfo);
  assert.ok((await say(fakeInteraction('info', { name: 'vot' }, '!cc info vot'))).includes('does not exist. Did you mean `vote`?'));
  assert.ok(command.data.toJSON().options.some((option) => option.name === 'info'), 'info is a subcommand');

  // !cc list: a page at a time, sorted by name, with what each one is, how it starts and its size.
  const listed2 = fakeInteraction('list', {}, '!cc list');
  await command.execute(listed2);
  const page = JSON.stringify(listed2.out[0].page.components.map((c) => c.toJSON()));
  assert.ok(page.includes('`hello` · text · `!hello` · 9 characters + embed `card`'), page);
  assert.ok(page.includes('`vote` · code · `.vote` ·'), page);
  assert.ok(page.indexOf('`copy`') < page.indexOf('`greet`') && page.indexOf('`greet`') < page.indexOf('`vote`'), 'sorted by name');
  for (let n = 0; n < 20; n += 1) store.set(`300000000000000001:z${String(n).padStart(2, '0')}`, { name: `z${String(n).padStart(2, '0')}`, code: 'x' });
  const { buildPage } = require('../src/utils/pager');
  const paged = JSON.stringify((await buildPage('customcommands', { guild: listed2.guild, userId: 'tester' })).components.map((c) => c.toJSON()));
  assert.ok(paged.includes('Showing 1–15 of') && paged.includes('::next'), 'a long list has pages');
  for (let n = 0; n < 20; n += 1) store.delete(`300000000000000001:z${String(n).padStart(2, '0')}`);

  const exported = await say(fakeInteraction('export', { name: 'greet' }, '!cc export greet'));
  const code = /pc1\.[A-Za-z0-9_-]+/.exec(exported)[0];
  assert.ok((await say(fakeInteraction('import', { share: code, name: 'copy' }, `!cc import ${code} copy`))).includes('imported'));
  assert.equal(store.get('300000000000000001:copy').code, store.get('300000000000000001:greet').code, 'an import gives the same code');
  assert.ok((await say(fakeInteraction('import', { share: 'pc1.zzz' }, '!cc import pc1.zzz'))).length > 0);
  const shown = await say(fakeInteraction('codeshow', { name: 'greet' }, '!cc codeshow greet'));
  assert.ok(shown.includes('new {{ 1 }}'));
  assert.ok(shown.includes('```handlebars\nnew {{ 1 }}\n```'), 'the code is shown in a block that colors the {{ }}');
  assert.ok((await say(fakeInteraction('codeshow', { name: 'nope' }, '!cc codeshow nope'))).includes('does not exist'));
  assert.ok((await say(fakeInteraction('codeshow', { name: 'gret' }, '!cc codeshow gret'))).includes('Did you mean `greet`?'), 'a name with a typo says the closest command');
  assert.ok(!(await say(fakeInteraction('codeshow', { name: 'zzzzzz' }, '!cc codeshow zzzzzz'))).includes('Did you mean'));
  // A long code goes in a file.
  store.set('300000000000000001:long', { name: 'long', code: `{{/* ${'x'.repeat(2000)} */}}` });
  const longShown = fakeInteraction('codeshow', { name: 'long' }, '!cc codeshow long');
  assert.ok((await say(longShown)).includes('is long, so it is in this file'));

  // The helpers behind the test and info.
  const admin = require('../src/utils/codeCommandAdmin');
  assert.deepEqual(admin.codeHints('{{ .User.Username }}{{ with .User }}{{ .Whatever }}{{ end }}{{ range .Args }}{{ .X }}{{ end }}{{ $.Member.Nick }}{{ .Button.ID }}{{ .Fields.reason }}'), [], 'known names, and the dot inside with and range, are not hints');
  assert.deepEqual(admin.codeHints('{{ if }}'), [], 'code with a mistake has no hints');
  assert.deepEqual(admin.codeHints('{{ .User.DisplayName }}{{ $.Usr }}{{ .Guild.Zzzzzzzz }}'), [
    '.User.DisplayName is not in the data, so it gives nothing. Did you mean .Member.DisplayName?',
    '.Usr is not in the data, so it gives nothing. Did you mean .User?',
    '.Guild.Zzzzzzzz is not in the data, so it gives nothing.',
  ]);
  assert.ok(admin.codeHints('{{ .Usr.ID }}')[0].startsWith('.Usr is not in the data. Did you mean .User?'), 'a name in the middle of a path stops the code, it does not give nothing');
  assert.deepEqual(admin.codeHints('{{ nope }}{{ nope }}'), ['There is no function called "nope".'], 'each name once');
  for (const template of TEMPLATES) assert.deepEqual(admin.codeHints(template.code), [], `the template ${template.id} has no hints`);
  const summary = admin.codeSummary('{{ getMember .User.ID }}{{ showModal (cmodal "id" "f" "title" "T" "fields" (cslice (ctext "id" "a" "label" "A"))) }}{{ sendDM "x" }}{{ addRole "1" }}');
  assert.deepEqual(summary.functions, ['addRole', 'cmodal', 'cslice', 'ctext', 'getMember', 'sendDM', 'showModal']);
  assert.ok(summary.forms && summary.directMessages && summary.roles && summary.lookups && !summary.storedData && !summary.buttons && !summary.menus && !summary.reactions);
  assert.equal(admin.codeSummary('{{ if }}'), null);
  assert.ok(admin.codeSummary('{{ if eq .Trigger "reaction" }}x{{ end }}').reactions, 'a command that answers reactions uses reactions');
  assert.deepEqual(admin.effectDetails({ type: 'addRole', roleId: '1' }), [], 'an action that is not a message has no details');
  assert.deepEqual(admin.effectDetails({ type: 'modal', modal: { title: 'T', fields: [{ label: 'Why', required: true }, { label: 'More', required: false }] } }), ['Fields: "Why", "More" (optional)']);
  assert.deepEqual(admin.effectDetails({ type: 'dm', embed: {} }), ['Embed: empty']);

  console.log('Checked the custom commands in code: who writes them, what they may do, the limits of pings, roles and channels, share codes and the templates.');
})().catch((error) => { console.error(error); process.exit(1); });
