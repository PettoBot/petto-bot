const { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { languageOf } = require('../../i18n');
const { quotePieces, isEmptyQuote } = require('../../utils/quoteText');
const { renderQuote } = require('../../imgutils/quoteCard');
const { loadImageFromLink } = require('../../utils/safeImage');
const { loadInputImage, avatarUrl } = require('../../utils/imageInput');
const { resolveUser } = require('../../utils/userResolve');
const { attachFilesProblem, replyPlain, replyError, repliedMessageOf, guarded, withRenderSlot } = require('../../utils/imageCommands');

const EMOJI_WAIT_MS = 5000;
const FLAGS = /(^|\s)--(colou?r|light|white|bold)(?=\s|$)/gi;
const MESSAGE_LINK = /^<?https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})>?$/i;
const SNOWFLAKE = /^\d{15,25}$/;
const MEMBER_TOKEN = /^(?:<@!?\d{15,25}>|\d{15,25})$/;

/** The options written in the text (`--color`, `--light`, `--bold`) and the text without them. */
function readFlags(text) {
  const flags = { color: false, light: false, bold: false };
  const rest = String(text ?? '').replace(FLAGS, (_, space, name) => {
    const key = name.toLowerCase();
    if (key.startsWith('colo')) flags.color = true;
    else if (key === 'bold') flags.bold = true;
    else flags.light = true;
    return space;
  }).trim();
  return { flags, rest };
}

/** A member written at the start or at the end of the text (`@member words` or `words @member`): `{ token, words }`, or null. */
function splitMember(text) {
  const parts = text.split(/\s+/);
  if (parts.length < 2) return null;
  if (MEMBER_TOKEN.test(parts[0])) return { token: parts[0], words: text.slice(parts[0].length).trim() };
  const last = parts[parts.length - 1];
  if (MEMBER_TOKEN.test(last)) return { token: last, words: text.slice(0, text.length - last.length).trim() };
  return null;
}

/** A message from a link to this server, only when the member (and Petto) can read that channel. */
async function messageFromLink(interaction, guildId, channelId, messageId) {
  if (guildId !== interaction.guild.id) return { error: 'images.quote.otherServer' };
  const channel = interaction.guild.channels.cache.get(channelId) ?? await interaction.guild.channels.fetch(channelId).catch(() => null);
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  const me = interaction.guild.members.me;
  if (!channel?.messages || !channel.permissionsFor?.(interaction.member)?.has(needed) || (me && !channel.permissionsFor(me)?.has(needed))) return { error: 'images.quote.notFound' };
  const found = await channel.messages.fetch(messageId).catch(() => null);
  return found ? { message: found } : { error: 'images.quote.notFound' };
}

/** The display name of a user in this server. */
function nameIn(guild, user) {
  return guild?.members?.cache?.get(user.id)?.displayName ?? user.globalName ?? user.username;
}

/** What is quoted: `{ text, user, name }` from a replied message, a link, an ID or the text itself, or `{ error }`. */
async function findQuote(interaction, rest) {
  const message = interaction.rawMessage;
  const replied = await repliedMessageOf(message);
  let quoted = replied;
  if (!quoted && rest) {
    const link = MESSAGE_LINK.exec(rest);
    if (link) {
      const found = await messageFromLink(interaction, link[1], link[2], link[3]);
      if (found.error) return found;
      quoted = found.message;
    } else if (SNOWFLAKE.test(rest)) {
      quoted = await message.channel.messages.fetch(rest).catch(() => null);
    }
  }
  if (quoted) {
    const embed = quoted.embeds?.[0];
    const text = quoted.content || embed?.description || embed?.title || '';
    return { text, user: quoted.author, name: quoted.member?.displayName ?? nameIn(interaction.guild, quoted.author), mentions: quoted.mentions };
  }
  if (!rest) return { error: 'images.quote.usage' };
  const split = splitMember(rest);
  if (split) {
    const user = await resolveUser(interaction.client, split.token, interaction.guild).catch(() => null);
    if (user) return { text: split.words, user, name: nameIn(interaction.guild, user) };
  }
  return { text: rest, user: interaction.user, name: interaction.member?.displayName ?? nameIn(interaction.guild, interaction.user) };
}

/** The images of the emojis of a quote (custom and Unicode), waiting at most a few seconds: the ones missing are written as text. */
async function loadEmojis(pieces) {
  const wanted = new Map();
  for (const piece of pieces) if (piece.type === 'emoji' && !wanted.has(piece.key)) wanted.set(piece.key, piece.url);
  const images = new Map();
  if (!wanted.size) return images;
  const loads = [...wanted].map(async ([key, url]) => {
    const image = await loadImageFromLink(url);
    if (image) images.set(key, image);
  });
  let timer;
  await Promise.race([Promise.all(loads), new Promise((resolve) => { timer = setTimeout(resolve, EMOJI_WAIT_MS); })]);
  clearTimeout(timer);
  // A copy: an emoji that arrives after the wait must not change the map while the picture is drawn.
  return new Map(images);
}

module.exports = {
  aliases: ['q', 'miq'],
  cooldownMs: 5000,
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Turn a message into a black and white quote picture.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('text').setDescription('A message link or ID, or text (and a member); or reply to a message').setRequired(false)),
  // The text is read as typed: quotes, line breaks and the --color, --light and --bold options stay as they were written.
  prefixRawOptions: { _: (text) => ({ text }) },
  readFlags,
  splitMember,

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const problem = attachFilesProblem(interaction, lang);
    if (problem) { await replyPlain(interaction, problem); return; }
    if (!interaction.rawMessage) { await replyError(interaction, lang, 'images.quote.usage', { prefix: '!' }); return; }

    const { flags, rest } = readFlags(interaction.options.getString('text'));
    const prefix = interaction.typedPrefix ?? '!';
    await guarded(interaction, lang, 'quote', async () => {
      const found = await findQuote(interaction, rest);
      if (found.error) { await replyError(interaction, lang, found.error, { prefix }); return; }
      const guild = interaction.guild;
      const names = {
        user: (id) => guild.members.cache.get(id)?.displayName ?? found.mentions?.users?.get(id)?.globalName ?? found.mentions?.users?.get(id)?.username ?? interaction.client.users.cache.get(id)?.username ?? null,
        role: (id) => guild.roles.cache.get(id)?.name ?? null,
        channel: (id) => guild.channels.cache.get(id)?.name ?? null,
      };
      const pieces = quotePieces(found.text, names);
      if (isEmptyQuote(pieces)) { await replyError(interaction, lang, 'images.quote.noText'); return; }

      const [avatar, emojis] = await Promise.all([
        loadInputImage(avatarUrl(guild, found.user)).then((loaded) => loaded.image).catch(() => null),
        loadEmojis(pieces),
      ]);
      const buffer = await withRenderSlot(() => renderQuote({
        pieces, emojis, avatar, displayName: found.name, username: found.user.username, ...flags,
      }));
      await interaction.reply({ files: [new AttachmentBuilder(buffer, { name: 'quote.png' })], allowedMentions: { parse: [], repliedUser: false } });
    });
  },
};
