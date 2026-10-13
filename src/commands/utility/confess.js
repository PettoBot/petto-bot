const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../db/confessions');
const { submit, MAX_CONTENT } = require('../../utils/confessions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const V2 = MessageFlags.IsComponentsV2;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

module.exports = {
  aliases: ['confession-send'],
  data: new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Confess something without anyone knowing it was you.')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('text').setDescription('What you want to say (a link to a picture can go inside it)').setMaxLength(MAX_CONTENT).setRequired(true))
    .addAttachmentOption((o) => o.setName('image').setDescription('A picture to go with it (optional)').setRequired(false)),

  async execute(interaction) {
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled || !config.channel_id) return reply(interaction, `${EMOJI.DENY}  Confessions are not turned on in this server.`, 0xff6b6b, true);
    if (!config.allow_command) return reply(interaction, `${EMOJI.DENY}  Here confessions are made with the button of the confessions panel.`, 0xff6b6b, true);
    // The answer is only for the member, so nobody sees who used the command.
    if (typeof interaction.deferReply === 'function' && !interaction.deferred && !interaction.replied && interaction.isChatInputCommand?.() && !interaction.rawMessage) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const attachments = interaction.rawMessage ? [...interaction.rawMessage.attachments.values()] : [interaction.options.getAttachment?.('image')].filter(Boolean);
    const result = await submit({ guild: interaction.guild, user: interaction.user, text: interaction.options.getString('text', true), attachments });
    const text = result.error ? `${EMOJI.DENY}  ${result.error}` : result.review ? `${EMOJI.APPROVE}  Your confession was sent to the staff. It shows up when they approve it.` : `${EMOJI.APPROVE}  Your confession was posted${result.message?.url ? `: ${result.message.url}` : '.'}`;
    const payload = { components: [textCard(text, result.error ? 0xff6b6b : 0xa5ea7a)], flags: V2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    return interaction.deferred ? interaction.editReply({ components: payload.components, flags: V2 }) : interaction.reply(payload);
  },
};
