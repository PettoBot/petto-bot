const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../db/suggestions');
const { submit, MAX_CONTENT } = require('../../utils/suggestions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

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
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled || !config.channel_id) return reply(interaction, `${EMOJI.DENY}  Suggestions are not turned on in this server.`, 0xff6b6b, true);
    if (!config.allow_command) return reply(interaction, `${EMOJI.DENY}  Here suggestions are made ${config.listen_channel ? `by writing in <#${config.channel_id}>` : 'with the button of the suggestions panel'}.`, 0xff6b6b, true);
    // A suggestion can take a moment (the message, the thread); a slash command has to answer first.
    if (typeof interaction.deferReply === 'function' && !interaction.deferred && !interaction.replied && interaction.isChatInputCommand?.() && !interaction.rawMessage) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const attachments = interaction.rawMessage ? [...interaction.rawMessage.attachments.values()] : [];
    const result = await submit({ guild: interaction.guild, user: interaction.user, text: interaction.options.getString('text', true), attachments });
    const text = result.error ? `${EMOJI.DENY}  ${result.error}` : `${EMOJI.APPROVE}  Your suggestion was posted${result.message?.url ? `: ${result.message.url}` : '.'}`;
    const payload = { components: [textCard(text, result.error ? 0xff6b6b : 0xa5ea7a)], flags: V2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    return interaction.deferred ? interaction.editReply({ components: payload.components, flags: V2 }) : interaction.reply(payload);
  },
};
