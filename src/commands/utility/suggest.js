const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../db/suggestions');
const { submit, MAX_CONTENT } = require('../../utils/suggestions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

module.exports = {
  aliases: ['sug'],
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Make a suggestion for this server. The server votes on it.')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('text').setDescription('Your suggestion (a link to a picture can go inside it)').setMaxLength(MAX_CONTENT).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled || !config.channel_id) return reply(interaction, `${EMOJI.DENY}  ${t(lang, 'suggestions.error.off')}`, 0xff6b6b, true);
    if (!config.allow_command) return reply(interaction, config.listen_channel ? t(lang, 'suggestions.suggest.byWriting', { emoji: EMOJI.DENY, channel: `<#${config.channel_id}>` }) : t(lang, 'suggestions.suggest.byPanel', { emoji: EMOJI.DENY }), 0xff6b6b, true);
    // A suggestion can take a moment (the message, the thread); a slash command has to answer first.
    if (typeof interaction.deferReply === 'function' && !interaction.deferred && !interaction.replied && interaction.isChatInputCommand?.() && !interaction.rawMessage) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const attachments = interaction.rawMessage ? [...interaction.rawMessage.attachments.values()] : [];
    const result = await submit({ guild: interaction.guild, user: interaction.user, text: interaction.options.getString('text', true), attachments });
    const posted = result.message?.url ? t(lang, 'suggestions.posted.link', { link: result.message.url }) : t(lang, 'suggestions.posted.plain');
    const text = result.error ? `${EMOJI.DENY}  ${result.error}` : `${EMOJI.APPROVE}  ${posted}`;
    const payload = { components: [textCard(text, result.error ? 0xff6b6b : 0xa5ea7a)], flags: V2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    return interaction.deferred ? interaction.editReply({ components: payload.components, flags: V2 }) : interaction.reply(payload);
  },
};
