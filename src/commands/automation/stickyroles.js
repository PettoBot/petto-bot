const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const stickyRolesDb = require('../../db/stickyRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['sr'],
  data: new SlashCommandBuilder()
    .setName('stickyroles')
    .setDescription('Automatically restore a member\'s roles if they leave and rejoin.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('enable').setDescription('Turn on sticky roles.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off sticky roles.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show whether sticky roles is on.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    if (sub === 'status') {
      const config = await stickyRolesDb.getConfig(interaction.guild.id);
      const text = t(lang, config?.enabled ? 'automation.stickyroles.statusOn' : 'automation.stickyroles.statusOff');
      await interaction.editReply({ components: [textCard(text, config?.enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    await ensureGuild(interaction.guild.id);
    const enabled = sub === 'enable';
    await stickyRolesDb.setEnabled(interaction.guild.id, enabled);

    const text = t(lang, enabled ? 'automation.stickyroles.enabled' : 'automation.stickyroles.disabled', { emoji: EMOJI.APPROVE });
    await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
  },
};
