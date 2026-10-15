// Shows where members appeal a sanction of this server and whether appeals are open.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getConfig, countPending } = require('../../db/appeals');
const { siteLink } = require('../../utils/appeals');
const { textCard } = require('../../utils/caseCard');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['appeal'],
  data: new SlashCommandBuilder()
    .setName('appeals')
    .setDescription('See the appeal page of this server and how many appeals wait for an answer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const config = await getConfig(interaction.guild.id);
    const link = siteLink(interaction.guild.id, config.slug);
    if (!config.enabled) {
      return interaction.editReply({ components: [textCard(t(lang, 'moderation.appeals.off', { link }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    }
    let pending = 0;
    try { pending = await countPending(interaction.guild.id); } catch { /* The count is a bonus. */ }
    return interaction.editReply({ components: [textCard(t(lang, 'moderation.appeals.on', { link, count: pending }), 0xf0a88f)], flags: MessageFlags.IsComponentsV2 });
  },
};
