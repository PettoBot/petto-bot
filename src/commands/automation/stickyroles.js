const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const stickyRolesDb = require('../../db/stickyRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stickyroles')
    .setDescription('Automatically restore a member\'s roles if they leave and rejoin.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('enable').setDescription('Turn on sticky roles.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off sticky roles.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show whether sticky roles is on.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    if (sub === 'status') {
      const config = await stickyRolesDb.getConfig(interaction.guild.id);
      const text = `**Sticky roles:** ${config?.enabled ? 'On' : 'Off'}\nSnapshots older than 90 days are never restored.`;
      await interaction.editReply({ components: [textCard(text, config?.enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    await ensureGuild(interaction.guild.id);
    const enabled = sub === 'enable';
    await stickyRolesDb.setEnabled(interaction.guild.id, enabled);

    const text = enabled
      ? `${EMOJI.APPROVE}  Sticky roles enabled. A member's roles (except managed ones) are saved when they leave, and restored if they rejoin within 90 days.`
      : `${EMOJI.APPROVE}  Sticky roles disabled.`;
    await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
  },
};
