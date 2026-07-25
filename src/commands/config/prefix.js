const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild, updateGuild } = require('../../db/guilds');
const { setCachedPrefix } = require('../../events/messageCreateCommands');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['pfx'],
  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('View or change the command prefix.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('new_prefix').setDescription('New prefix, up to 5 characters').setRequired(false)),

  async execute(interaction) {
    const newPrefix = interaction.options.getString('new_prefix');
    const guildConfig = await ensureGuild(interaction.guild.id);

    if (!newPrefix) {
      const text = `**Current prefix:** \`${guildConfig.prefix}\`\nYou can always use ${interaction.client.user} as a prefix too, even if you forget this one.`;
      await interaction.reply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (newPrefix.length > 5) {
      await interaction.reply({ content: 'Prefix must be 5 characters or fewer.', flags: MessageFlags.Ephemeral });
      return;
    }

    await updateGuild(interaction.guild.id, { prefix: newPrefix });
    setCachedPrefix(interaction.guild.id, newPrefix);

    await interaction.reply({ components: [textCard(`${EMOJI.APPROVE}  Prefix set to \`${newPrefix}\`.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  },
};
