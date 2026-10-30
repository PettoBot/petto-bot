const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { uwuify, uwuLanguage, MESSAGE_LIMIT } = require('../../utils/uwu');
const { noticePayload } = require('../../utils/infoCard');
const { repliedMessageOf } = require('../../utils/imageCommands');
const { commandRef } = require('../../utils/commandRef');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

/** The text of a message to change: what it says, or the first embed it has. */
function textOf(message) {
  const embed = message?.embeds?.[0];
  return message?.content || embed?.description || embed?.title || '';
}

module.exports = {
  aliases: ['uwuify'],
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('uwu')
    .setDescription('Turn a text, or the message you reply to, into uwu speak.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('text').setDescription('The text to change (or reply to a message)').setRequired(false).setMaxLength(MESSAGE_LIMIT)),
  // The text keeps its line breaks, code blocks and quotes, so it is read raw: `!uwu some text`.
  prefixRawOptions: { _: (text) => (text ? { text } : {}) },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    let source = (interaction.options.getString('text') ?? '').trim();
    // With no text, the message this one answers (`!uwu` as a reply) is the text.
    if (!source && interaction.rawMessage) source = textOf(await repliedMessageOf(interaction.rawMessage)).trim();

    const reply = (key, vars) => interaction.reply({
      ...noticePayload(t(lang, key, vars), COLORS.RED),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: { parse: [], repliedUser: false },
    });
    if (!source) return reply('fun.uwu.usage', { command: commandRef(interaction, 'uwu') });
    const text = uwuify(source, { lang: uwuLanguage(lang) });
    if (!text) return reply('fun.uwu.empty');
    // The words are never allowed to ping anybody, whatever the text says.
    return interaction.reply({ content: text, allowedMentions: { parse: [], repliedUser: false } });
  },
};
