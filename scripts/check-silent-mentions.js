// Checks silent mentions: a `!` right before a mention shows the pill and notifies nobody. Every form of the syntax, role names, the
// escape, a `!` inside a word, silent and normal mentions together, Components V2 text, embeds, webhooks, variables expanded first, and
// that a payload with no `!` mention (and the policy `parse: []`) comes out exactly as it went in.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });

const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, EmbedBuilder, MessagePayload, MessageFlags } = require('discord.js');
const { applySilentMentions, ZWSP } = require('../src/utils/silentMentions');
const { installSilentMentions, guildOf } = require('../src/utils/silentMentionsHook');
const { resolve } = require('../src/utils/embedVariables');

const MOD = '111111111111111111';
const STAFF = '222222222222222222';
const USER = '333333333333333333';
const USER2 = '444444444444444444';
const CHANNEL = '555555555555555555';
const guild = { id: '999999999999999999', roles: { cache: new Map([
  ['999999999999999999', { id: '999999999999999999', name: '@everyone', position: 0 }],
  [MOD, { id: MOD, name: 'Moderators', position: 5 }],
  [STAFF, { id: STAFF, name: 'Staff Team', position: 3 }],
]) } };

const text = (content, allowedMentions) => applySilentMentions({ content, ...(allowedMentions ? { allowedMentions } : {}) }, guild);
const on = (content, allowedMentions) => text(content, allowedMentions);

(() => {
  // Every form: the `!` goes and the mention stays.
  assert.equal(on('!@everyone').content, '@everyone');
  assert.equal(on('!@here hi').content, '@here hi');
  assert.equal(on(`!<@&${MOD}>`).content, `<@&${MOD}>`);
  assert.equal(on(`!<@${USER}>`).content, `<@${USER}>`);
  assert.equal(on(`!<@!${USER}>`).content, `<@!${USER}>`);
  assert.equal(on(`a !<@${USER}> b`).content, `a <@${USER}> b`);
  assert.equal(on('15 digits !<@123456789012345> and 22 !<@1234567890123456789012>').content, '15 digits <@123456789012345> and 22 <@1234567890123456789012>');
  assert.equal(on('!<@12345678901234>').content, '!<@12345678901234>', 'an id of 14 digits is not an id');
  assert.equal(on('!<@12345678901234567890123>').content, '!<@12345678901234567890123>', 'an id of 23 digits is not an id');

  // A role by name: any case, and with spaces in quotes; it becomes the mention of the role.
  assert.equal(on('!@Moderators').content, `<@&${MOD}>`);
  assert.equal(on('!@moderators and !@MODERATORS').content, `<@&${MOD}> and <@&${MOD}>`);
  assert.equal(on('!@"staff team" hi').content, `<@&${STAFF}> hi`);
  assert.equal(on('(!@Moderators), thanks!@Moderators').content, `(<@&${MOD}>), thanks!@Moderators`, 'punctuation after the name is kept, a ! inside a word is not silent');
  assert.equal(on('!@Moderators.').content, `<@&${MOD}>.`);
  assert.equal(on('!@Nobody').content, '!@Nobody', 'a name that is no role stays as typed, with its !');
  assert.equal(on('!@"No such role"').content, '!@"No such role"');
  assert.equal(on('!@Staff Team').content, '!@Staff Team', 'a name with spaces needs the quotes');
  assert.equal(applySilentMentions({ content: '!@Moderators' }, null).content, '!@Moderators', 'without a server a name cannot be found');
  assert.equal(applySilentMentions({ content: `!<@&${MOD}>` }, null).content, `<@&${MOD}>`, 'without a server the other forms still work');

  // Where the `!` may stand.
  assert.equal(on('hello!@here').content, 'hello!@here', 'a ! that is part of a word is not silent');
  assert.equal(on('hello !@here').content, 'hello @here');
  assert.equal(on('line\n!@here').content, 'line\n@here');
  assert.equal(on('**!@here**').content, '**@here**');
  assert.equal(on('¿Listos?!@here').content, '¿Listos?@here', 'punctuation before it counts');
  assert.equal(on('!!@here').content, '!@here');
  assert.equal(on('`!@everyone`').content, '`!@everyone`', 'inside inline code it is text');
  assert.equal(on('```\n!@everyone\n```').content, '```\n!@everyone\n```', 'inside a code block it is text');
  assert.equal(on('!@everyone `x` !@here').content, '@everyone `x` @here');
  assert.equal(on('!@everyoneelse').content, '!@everyoneelse');
  assert.equal(on('! @here').content, '! @here', 'a space between is not silent');

  // A channel never notifies: only the ! goes.
  const channel = on(`!<#${CHANNEL}>`, { parse: ['users', 'roles'] });
  assert.equal(channel.content, `<#${CHANNEL}>`);
  assert.deepEqual(channel.allowedMentions, { parse: ['users', 'roles'] }, 'a channel changes nothing in the allowed mentions');

  // The escape: `!` and the mention as plain text, that notifies nobody even with another mention that does.
  const escaped = on('\\!@everyone and !@here', undefined);
  assert.equal(escaped.content, `!@${ZWSP}everyone and @here`);
  assert.equal(on(`\\!<@&${MOD}>`).content, `!<${ZWSP}@&${MOD}>`);
  assert.equal(on('\\!@everyone @everyone', { parse: ['everyone'] }).content, `!@${ZWSP}everyone @everyone`);
  assert.equal(on('\\!@Moderators').content, `!@${ZWSP}Moderators`);
  assert.equal(on('\\!@everyone').allowedMentions, undefined, 'the escape alone asks nothing of the allowed mentions');
  assert.equal(applySilentMentions(on('\\!@everyone'), guild).content, `!@${ZWSP}everyone`, 'run twice it stays the same');
  assert.equal(on('plain \\! text').content, 'plain \\! text', 'a backslash and a ! with no mention are left alone');

  // allowedMentions: silent mentions leave the lists, normal ones stay.
  const none = on('!@everyone');
  assert.deepEqual(none.allowedMentions, { parse: [], roles: [], users: [] }, 'no allowed mentions given: explicit ones with only the normal mentions');
  const both = on(`!<@&${MOD}> <@&${STAFF}> !<@${USER}> <@${USER2}> !@here`);
  assert.deepEqual(both.allowedMentions, { parse: [], roles: [STAFF], users: [USER2] });
  const everyoneNormal = on(`@everyone !<@&${MOD}>`);
  assert.deepEqual(everyoneNormal.allowedMentions, { parse: ['everyone'], roles: [], users: [] });
  assert.deepEqual(on('@here !@everyone').allowedMentions, { parse: ['everyone'], roles: [], users: [] }, 'a silent and a normal @everyone in one message notify: Discord decides for the whole message');
  assert.deepEqual(on('!@everyone', { parse: ['everyone'], repliedUser: true }).allowedMentions, { parse: [], repliedUser: true }, 'repliedUser is kept');
  assert.deepEqual(applySilentMentions({ content: `!<@&${MOD}>` }, guild).allowedMentions, { parse: [], roles: [], users: [] });

  // parse lists become explicit lists without the silent mentions; nothing is ever added.
  const parsed = on(`!<@&${MOD}> <@&${STAFF}> <@${USER}>`, { parse: ['users', 'roles'] });
  assert.deepEqual(parsed.allowedMentions, { parse: ['users'], roles: [STAFF] });
  const parsedUser = on(`!<@${USER}> <@${USER2}> <@&${STAFF}>`, { parse: ['users', 'roles'] });
  assert.deepEqual(parsedUser.allowedMentions, { parse: ['roles'], users: [USER2] });
  assert.deepEqual(on('!@everyone hi', { parse: ['everyone', 'users'] }).allowedMentions, { parse: ['users'] });
  assert.deepEqual(on(`!<@&${MOD}>`, { parse: ['users'] }).allowedMentions, { parse: ['users'] }, 'a permission that was not there is not added (no roles list)');
  assert.deepEqual(on(`!<@&${MOD}> <@${USER}>`, { parse: [] }).allowedMentions, { parse: [] }, 'parse: [] stays parse: []');
  assert.deepEqual(on('!@everyone', { parse: [] }).allowedMentions, { parse: [] });
  const lists = on(`!<@&${MOD}> <@&${STAFF}> !<@${USER}>`, { roles: [MOD, STAFF], users: [USER, USER2], parse: [] });
  assert.deepEqual(lists.allowedMentions, { roles: [STAFF], users: [USER2], parse: [] }, 'explicit lists lose the silent ids');
  const keep = on(`!<@&${MOD}> <@&${MOD}>`, { roles: [MOD] });
  assert.deepEqual(keep.allowedMentions, { roles: [MOD] }, 'an id mentioned both ways stays: it notifies');
  assert.deepEqual(on('!@Moderators', { roles: [MOD, STAFF] }).allowedMentions, { roles: [STAFF] }, 'a role by name leaves the list too');
  // The client's own policy counts when the payload says nothing: `parse: []` is never widened, a wider one is narrowed.
  const quiet = applySilentMentions({ content: `!<@&${MOD}> <@${USER}>` }, guild, { defaults: { parse: [] } });
  assert.equal(quiet.content, `<@&${MOD}> <@${USER}>`);
  assert.equal(quiet.allowedMentions, undefined, 'the client default parse: [] stays as it is');
  const wide = applySilentMentions({ content: `!<@${USER}> <@${USER2}>` }, guild, { defaults: { parse: ['users'] } });
  assert.deepEqual(wide.allowedMentions, { parse: [], users: [USER2] });

  // Classic embeds never notify: the ! is removed and nothing else changes.
  const embed = new EmbedBuilder().setTitle('!@everyone t').setDescription(`d !<@&${MOD}> !<#${CHANNEL}> !@Moderators`).addFields({ name: '!@here', value: `!<@${USER}>`, inline: true }).setFooter({ text: '!@everyone f' });
  const embedded = applySilentMentions({ content: 'plain', embeds: [embed], allowedMentions: { parse: ['users', 'roles'] } }, guild);
  const raw = embedded.embeds[0];
  assert.equal(raw.title, '@everyone t');
  assert.equal(raw.description, `d <@&${MOD}> <#${CHANNEL}> <@&${MOD}>`);
  assert.deepEqual(raw.fields, [{ name: '@here', value: `<@${USER}>`, inline: true }]);
  assert.equal(raw.footer.text, '@everyone f');
  assert.deepEqual(embedded.allowedMentions, { parse: ['users', 'roles'] }, 'an embed never changes who is notified');
  assert.equal(applySilentMentions({ embeds: [{ description: 'hello!@here' }] }, guild).embeds[0].description, 'hello!@here');
  assert.equal(applySilentMentions({ embeds: [{ description: 'x' }, { description: '!@here' }] }, guild).embeds[1].description, '@here');
  // Both a message and an embed: the text of the message decides the notifications, the embed adds none.
  const mixed = applySilentMentions({ content: `<@${USER}>`, embeds: [{ description: `!<@${USER2}> <@${USER}>` }], allowedMentions: { parse: ['users'] } }, guild);
  assert.deepEqual(mixed.allowedMentions, { parse: ['users'] }, 'only a silent mention in the message text changes the allowed mentions');

  // Components V2: text displays, sections and containers at any depth, as builders or as JSON.
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`!<@&${MOD}> top <@${USER}>`))
    .addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('!@everyone in a section'), new TextDisplayBuilder().setContent('hello!@here')).setThumbnailAccessory((thumb) => thumb.setURL('https://example.com/a.png')));
  const v2 = applySilentMentions({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: ['users', 'roles', 'everyone'] } }, guild);
  const json = v2.components[0].toJSON ? v2.components[0].toJSON() : v2.components[0];
  assert.equal(json.components[0].content, `<@&${MOD}> top <@${USER}>`);
  assert.equal(json.components[1].components[0].content, '@everyone in a section');
  assert.equal(json.components[1].components[1].content, 'hello!@here');
  assert.equal(json.components[1].accessory.type, 11, 'the accessory of a section is kept');
  assert.equal(v2.flags, MessageFlags.IsComponentsV2);
  assert.ok(!v2.allowedMentions.parse.includes('roles'), 'the silent role left the policy');
  assert.ok(v2.allowedMentions.parse.includes('everyone'), 'hello!@here is a normal @here, so the message still notifies everyone');
  assert.ok(v2.allowedMentions.parse.includes('users'), 'the normal user mention is still notified');
  assert.deepEqual(v2.allowedMentions.roles, []);
  const rawV2 = applySilentMentions({ components: [{ type: 17, components: [{ type: 10, content: '!@here' }, { type: 9, components: [{ type: 10, content: `!<@${USER}>` }], accessory: { type: 11, media: { url: 'https://example.com/a.png' } } }, { type: 14 }] }], flags: 32768 }, guild);
  assert.equal(rawV2.components[0].components[0].content, '@here');
  assert.equal(rawV2.components[0].components[1].components[0].content, `<@${USER}>`);
  assert.deepEqual(rawV2.components[0].components[2], { type: 14 });
  assert.deepEqual(rawV2.allowedMentions, { parse: [], roles: [], users: [] }, 'no allowed mentions: explicit ones');
  assert.equal(applySilentMentions({ components: [{ type: 1, components: [{ type: 2, label: '!@here', custom_id: 'x', style: 1 }] }] }, guild).components[0].components[0].label, '!@here', 'a button label is not text that notifies');

  // A webhook payload: the same, with the look it carries untouched.
  const hook = applySilentMentions({ content: `!<@&${MOD}> hi`, username: 'Quest Hunter', avatarURL: 'https://example.com/a.png', threadId: 'T', withComponents: true }, guild);
  assert.equal(hook.content, `<@&${MOD}> hi`);
  assert.equal(hook.username, 'Quest Hunter');
  assert.equal(hook.threadId, 'T');
  assert.equal(hook.withComponents, true);

  // No `!` mention: the very same payload, with the same allowed mentions.
  for (const payload of [
    { content: 'Hello <@&111111111111111111> and @everyone!' },
    { content: 'Wow! @here' },
    { content: 'hello!@here' },
    { content: 'plain', allowedMentions: { parse: ['users', 'roles'], repliedUser: false } },
    { content: 'plain', allowedMentions: { parse: [] }, embeds: [new EmbedBuilder().setDescription('hi!').setTitle('t')] },
    { components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('hi! there'))], flags: 32768 },
    { content: 'x', files: [{ attachment: Buffer.from('a'), name: 'a.txt' }], username: 'n' },
    {},
  ]) {
    const result = applySilentMentions(payload, guild);
    assert.equal(result, payload, 'the payload is the same object');
    assert.deepEqual(Object.keys(result), Object.keys(payload));
  }
  assert.equal(applySilentMentions('just a string', guild), 'just a string');
  assert.deepEqual(applySilentMentions('!@here', guild), { content: '@here', allowedMentions: { parse: [], roles: [], users: [] } });
  assert.equal(applySilentMentions(null, guild), null);
  const original = { content: '!@here', allowedMentions: { parse: ['everyone'] } };
  const copy = JSON.stringify(original);
  applySilentMentions(original, guild);
  assert.equal(JSON.stringify(original), copy, 'the payload given is not modified');
})();

(async () => {
  // Variables are expanded before this step, so the output of a variable can be silent.
  const member = { id: USER, username: 'liam', displayAvatarURL: () => 'avatar' };
  const expanded = await resolve('Welcome !{user.mention} and !{user.mention}!', { user: member });
  assert.equal(expanded, `Welcome !<@${USER}> and !<@${USER}>!`);
  assert.equal(applySilentMentions({ content: expanded, allowedMentions: { users: [USER] } }, guild).content, `Welcome <@${USER}> and <@${USER}>!`);
  assert.deepEqual(applySilentMentions({ content: expanded, allowedMentions: { users: [USER] } }, guild).allowedMentions, { users: [] });
  const withRole = await resolve('!{level.role_name} !{level_role}', { levelReward: { id: MOD, name: 'Gold' } });
  assert.equal(applySilentMentions({ content: withRole }, guild).content, `!Gold <@&${MOD}>`, 'a variable that gives text is not a mention; the role mention is');

  // The hook: every send of the library goes through MessagePayload.resolveBody, so the body that reaches Discord is the final one.
  const listeners = [];
  installSilentMentions({ prependListener: (name, fn) => listeners.push([name, fn]) });
  installSilentMentions(null); // twice is the same as once
  const body = (target, options) => MessagePayload.create(target, options).resolveBody().body;
  const client = { options: { allowedMentions: { parse: [] } }, guilds: { cache: new Map([[guild.id, guild]]) } };
  const channel = { guild, client };
  const sent = body(channel, { content: `!<@&${MOD}> !@Moderators <@${USER}>`, allowedMentions: { parse: ['users', 'roles'], repliedUser: true } });
  assert.equal(sent.content, `<@&${MOD}> <@&${MOD}> <@${USER}>`);
  assert.deepEqual(sent.allowed_mentions, { parse: ['users'], roles: [], replied_user: true });
  const quietBody = body(channel, { content: `!<@&${MOD}> hi` });
  assert.equal(quietBody.content, `<@&${MOD}> hi`);
  assert.deepEqual(quietBody.allowed_mentions, { parse: [] }, 'the client default parse: [] is what goes');
  assert.deepEqual(body(channel, '!@everyone').allowed_mentions, { parse: [] });
  assert.equal(body(channel, { content: 'no silent here', allowedMentions: { parse: ['everyone'] } }).allowed_mentions.parse[0], 'everyone');
  // A message of the bot being edited, an interaction, an interaction webhook (editReply, followUp) and a webhook all find their server.
  const message = { guild, client, author: { id: 'bot' }, channel };
  assert.equal(body(message, { content: '!@Moderators' }).content, `<@&${MOD}>`);
  const interaction = { guild, guildId: guild.id, client };
  assert.equal(body(interaction, { content: '!@Moderators' }).content, `<@&${MOD}>`);
  const replyHook = { client };
  assert.equal(body(replyHook, { content: '!@Moderators' }).content, '!@Moderators', 'no server known yet');
  listeners[0][1]({ guildId: guild.id, webhook: replyHook });
  assert.equal(body(replyHook, { content: '!@Moderators' }).content, `<@&${MOD}>`, 'the interaction tells its webhook the server');
  const webhook = { guildId: guild.id, client, name: 'Petto messages' };
  assert.equal(guildOf(webhook), guild);
  const webhookBody = body(webhook, { content: '!<@&' + MOD + '> hi', username: 'Quest Hunter', allowedMentions: { parse: ['roles'] } });
  assert.equal(webhookBody.content, `<@&${MOD}> hi`);
  assert.deepEqual(webhookBody.allowed_mentions, { parse: [], roles: [] });
  // A client with no policy of its own (a WebhookClient): explicit mentions are built.
  const bare = { client: { options: {} } };
  assert.deepEqual(body(bare, { content: `!<@&${MOD}> <@${USER}>` }).allowed_mentions, { parse: [], roles: [], users: [USER] });
  // A body without a `!` mention is the one the library always made.
  const plain = { content: 'hi <@&' + MOD + '>', allowedMentions: { parse: ['roles'] } };
  assert.deepEqual(body(channel, plain), body(channel, { ...plain }));
  assert.deepEqual(body(channel, plain).allowed_mentions, { parse: ['roles'] });
  assert.equal(new MessagePayload(channel, plain).resolveBody().options, plain, 'the options are the same object when nothing is silent');
  // Whatever goes wrong inside, the message is still made.
  const broken = { get guild() { throw new Error('boom'); }, client };
  assert.equal(body(broken, { content: '!@here' }).content, '@here');

  console.log('check-silent-mentions: ok');
})().catch((error) => { console.error(error); process.exit(1); });
