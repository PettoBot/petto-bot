// Checks /snipe and its family: what is kept in memory for a channel (deleted and edited messages, removed reactions), what each
// subcommand shows, `!snipe 3`, the prefix words (`!editsnipe`, `!esnipe`, `!reactionsnipe`, `!clearsnipe`...), the permission it asks for and
// that nothing is ever saved outside memory.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const cache = require('../src/utils/snipeCache');
const snipe = require('../src/commands/utility/snipe');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const { DEFAULT_PREFIX_ROUTES } = require('../src/utils/defaultCommandAliases');

const GUILD = { id: '100000000000000001' };
const message = (id, content, extra = {}) => ({
  id, guild: GUILD, channelId: extra.channelId ?? 'c1', content, createdTimestamp: 1_700_000_000_000 + Number(id),
  author: { id: 'u1', username: 'ana', globalName: 'Ana', bot: false, avatar: 'abc123' },
  member: { displayName: 'Ana' }, attachments: new Map(), embeds: [], ...extra,
});
const reaction = (emoji, msg, extra = {}) => ({ emoji, message: msg, ...extra });
const person = (id, name, bot = false) => ({ id, username: name, globalName: name, bot, avatar: `hash${id}` });

// ---- the memory ---------------------------------------------------------------------------------------------------------------------
for (let i = 1; i <= 12; i += 1) cache.rememberDeleted(message(String(i), `text ${i}`));
assert.equal(cache.getDeleted('c1', 1).message.content, 'text 12', '1 is the latest');
assert.equal(cache.getDeleted('c1', 10).message.content, 'text 3', 'the cache keeps up to MAX_ENTRIES_PER_CHANNEL');
assert.equal(cache.getDeleted('c1', 11), null, 'older ones are gone');
assert.equal(cache.getDeleted('other', 1), null, 'each channel has its own');
assert.equal(cache.MAX_ENTRIES_PER_CHANNEL, 10);

cache.rememberEdited(message('50', 'before'), message('50', 'after'));
assert.equal(cache.getEdited('c1', 1).before, 'before');
assert.equal(cache.getEdited('c1', 1).after, 'after');
cache.rememberEdited(message('51', 'same'), message('51', 'same'));
assert.equal(cache.countFor('c1').edited, 1, 'an edit that changed nothing is not kept');

const target = message('70', 'look at this', { member: { displayName: 'Ana' } });
const dm = { id: '71', channelId: 'dm', guild: null, content: 'secret' };
cache.rememberReactionRemoved(reaction({ id: null, name: '👍' }, target), person('u2', 'Bob'));
cache.rememberReactionRemoved(reaction({ id: '555', name: 'party', animated: true }, target), person('u3', 'Cy'));
cache.rememberReactionRemoved(reaction({ id: null, name: '🔥' }, target), person('bot1', 'robot', true));
cache.rememberReactionRemoved(reaction({ id: null, name: '🔥' }, dm), person('u2', 'Bob'));
cache.rememberReactionRemoved(reaction({ id: null, name: null }, target), person('u2', 'Bob'));
cache.rememberReactionRemoved(reaction({ id: null, name: '🔥' }, target), null);
assert.equal(cache.countFor('c1').reactions, 2, 'a bot, a direct message, an emoji with no name and nobody are left out');
const last = cache.getReaction('c1', 1);
assert.equal(last.emoji.display, '<a:party:555>', 'a custom emoji is kept so it can be shown again');
assert.equal(last.emoji.url, 'https://cdn.discordapp.com/emojis/555.gif?size=96');
assert.equal(last.user.name, 'Cy');
assert.equal(cache.avatarUrl(last.user), 'https://cdn.discordapp.com/avatars/u3/hashu3.png?size=128', 'the avatar is kept as its hash');
assert.equal(cache.avatarUrl({ id: 'u1', avatar: null }), null);
assert.equal(last.message.url, 'https://discord.com/channels/100000000000000001/c1/70');
assert.equal(cache.getReaction('c1', 2).emoji.display, '👍');
assert.equal(cache.getReaction('c1', 3), null);
for (let i = 0; i < 15; i += 1) cache.rememberReactionRemoved(reaction({ id: null, name: '🎉' }, target), person(`p${i}`, `P${i}`));
assert.equal(cache.countFor('c1').reactions, 10, 'at most 10 reactions per channel');
const long = message('72', 'x'.repeat(900));
cache.rememberReactionRemoved(reaction({ id: null, name: '🎯' }, long), person('u9', 'Zed'));
assert.equal(cache.getReaction('c1', 1).message.preview.length, 200, 'only a short look at the message is kept');

// What is kept is only in memory: the cache module and the three events never reach the database or the disk.
for (const file of ['src/utils/snipeCache.js', 'src/events/messageDeleteSnipe.js', 'src/events/messageUpdateSnipe.js', 'src/events/messageCreateSnipe.js', 'src/events/messageReactionRemoveSnipe.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.doesNotMatch(source, /require\(['"][^'"]*(db\/|database|fs|postgres)/, `${file} keeps nothing outside memory`);
}

// Age: nothing older than a day is shown.
const realNow = Date.now;
Date.now = () => realNow() + 25 * 60 * 60 * 1000;
assert.equal(cache.getDeleted('c1', 1), null, 'a day later the deleted messages are forgotten');
assert.equal(cache.getReaction('c1', 1), null, 'and the reactions');
Date.now = realNow;

// ---- clear ----------------------------------------------------------------------------------------------------------------------------
cache.rememberDeleted(message('80', 'one', { channelId: 'c2' }));
cache.rememberEdited(message('81', 'a', { channelId: 'c2' }), message('81', 'b', { channelId: 'c2' }));
cache.rememberReactionRemoved(reaction({ id: null, name: '🙂' }, message('82', 'x', { channelId: 'c2' })), person('u2', 'Bob'));
cache.rememberDeleted(message('83', 'keep me', { channelId: 'c3' }));
assert.deepEqual(cache.countFor('c2'), { deleted: 1, edited: 1, reactions: 1 });
assert.equal(cache.clearChannel('c2', 'edited'), 1);
assert.deepEqual(cache.countFor('c2'), { deleted: 1, edited: 0, reactions: 1 }, 'one kind at a time');
assert.equal(cache.clearChannel('c2'), 2, 'the rest, by default');
assert.deepEqual(cache.countFor('c2'), { deleted: 0, edited: 0, reactions: 0 });
assert.equal(cache.clearChannel('c2'), 0);
assert.equal(cache.getDeleted('c3', 1).message.content, 'keep me', 'another channel is not touched');

// ---- the command ----------------------------------------------------------------------------------------------------------------------
assert.equal(BigInt(snipe.data.toJSON().default_member_permissions), PermissionFlagsBits.ManageMessages, 'every part of /snipe, clear included, asks for Manage Messages');
assert.deepEqual(snipe.data.toJSON().options.map((option) => option.name), ['deleted', 'edited', 'reactions', 'clear']);
assert.equal(snipe.data.toJSON().dm_permission, false);

const sent = [];
const channelMessage = (extra = {}) => ({
  guild: GUILD, client: {}, author: { id: 'mod' }, member: {}, channel: { id: 'c9', send: async (p) => { sent.push(p); return p; } },
  mentions: { users: new Map(), roles: new Map(), channels: new Map() }, reply: async (p) => { sent.push(p); return p; }, ...extra,
});
/** What `!<word> <args>` does after the route is applied, as messageCreateCommands.js does it. */
async function run(word, args = '', channelId = 'c9') {
  sent.length = 0;
  const route = DEFAULT_PREFIX_ROUTES.find((r) => r.alias === word);
  const argText = route ? [...route.args, args].filter(Boolean).join(' ') : args;
  if (route) assert.equal(route.command, 'snipe', `${word} is a word of /snipe`);
  const interaction = await buildInteractionFromMessage(channelMessage({ channel: { id: channelId } }), snipe, argText);
  assert.ok(interaction, `"!${word} ${args}" is read as a subcommand of snipe`);
  interaction.pettoLang = 'en';
  await snipe.execute(interaction);
  return { payload: sent[0], sub: interaction.options.getSubcommand() };
}

(async () => {
cache.rememberDeleted(message('90', 'first', { channelId: 'c9' }));
cache.rememberDeleted(message('91', 'second', { channelId: 'c9' }));
cache.rememberEdited(message('92', 'old text', { channelId: 'c9' }), message('92', 'new text', { channelId: 'c9' }));
cache.rememberEdited(message('93', 'older text', { channelId: 'c9' }), message('93', 'newer text', { channelId: 'c9' }));
cache.rememberReactionRemoved(reaction({ id: null, name: '👀' }, message('94', 'a message with a reaction', { channelId: 'c9' })), person('u2', 'Bob'));

let r = await run('snipe');
assert.equal(r.sub, 'deleted');
assert.equal(r.payload.embeds[0].toJSON().description, 'second', '!snipe is the latest deleted message');
assert.deepEqual(r.payload.allowedMentions, { parse: [] }, 'nothing is pinged');
assert.equal(r.payload.embeds[0].toJSON().author.icon_url, 'https://cdn.discordapp.com/avatars/u1/abc123.png?size=128');
r = await run('snipe', '2');
assert.equal(r.payload.embeds[0].toJSON().description, 'first', '!snipe 2 is the one before');
r = await run('snipe', 'deleted 2');
assert.equal(r.payload.embeds[0].toJSON().description, 'first');
r = await run('snipe', '9');
assert.match(r.payload.content, /no deleted message 9/i, 'a number with nothing behind it is told');

r = await run('snipe', 'edited');
assert.equal(r.sub, 'edited');
assert.deepEqual(r.payload.embeds[0].toJSON().fields.slice(0, 2).map((f) => f.value), ['older text', 'newer text']);
for (const word of ['editsnipe', 'esnipe']) {
  r = await run(word);
  assert.equal(r.sub, 'edited', `!${word} is !snipe edited`);
  assert.equal(r.payload.embeds[0].toJSON().fields[1].value, 'newer text');
  r = await run(word, '2');
  assert.equal(r.payload.embeds[0].toJSON().fields[1].value, 'new text', `!${word} 2 is the one before`);
}
r = await run('snipe', 'edit 2');
assert.equal(r.sub, 'edited', '`edit` is read as `edited`');

for (const word of ['reactionsnipe', 'rsnipe']) {
  r = await run(word);
  assert.equal(r.sub, 'reactions', `!${word} is !snipe reactions`);
  const embed = r.payload.embeds[0].toJSON();
  assert.match(embed.description, /👀 was removed by \*\*Bob\*\*/);
  assert.match(embed.description, /discord\.com\/channels\/100000000000000001\/c9\/94/);
  assert.match(embed.description, /a message with a reaction/);
  assert.deepEqual(r.payload.allowedMentions, { parse: [] });
}
r = await run('reactionsnipe', '2');
assert.match(r.payload.content, /no removed reaction 2/i);
r = await run('snipe', 'reaction');
assert.equal(r.sub, 'reactions');

r = await run('clearsnipe', 'edited');
assert.equal(r.sub, 'clear');
assert.match(r.payload.content, /Forgot 2 saved items/);
assert.deepEqual(cache.countFor('c9'), { deleted: 2, edited: 0, reactions: 1 });
r = await run('csnipe');
assert.match(r.payload.content, /Forgot 3 saved items/, '!csnipe forgets everything of the channel');
assert.deepEqual(cache.countFor('c9'), { deleted: 0, edited: 0, reactions: 0 });
r = await run('clearsnipe');
assert.match(r.payload.content, /Nothing was saved/);
r = await run('snipe', 'reset');
assert.equal(r.sub, 'clear');

// Spanish and Portuguese.
cache.rememberReactionRemoved(reaction({ id: null, name: '🎈' }, message('95', 'hola', { channelId: 'c9' })), person('u2', 'Bob'));
for (const [lang, expected] of [['es', /quitó 🎈/], ['pt-BR', /removeu 🎈/]]) {
  sent.length = 0;
  const interaction = await buildInteractionFromMessage(channelMessage({ channel: { id: 'c9' } }), snipe, 'reactions');
  interaction.pettoLang = lang;
  await snipe.execute(interaction);
  assert.match(sent[0].embeds[0].toJSON().description, expected, `${lang} text`);
}

console.log('check-snipe: ok');
})().catch((error) => { console.error(error); process.exit(1); });
