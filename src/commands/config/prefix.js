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
    const requestedPrefix = interaction.options.getString('new_prefix');
    const guildConfig = await ensureGuild(interaction.guild.id);

    if (requestedPrefix == null) {
      const text = `**Current prefix:** \`${guildConfig.prefix}\`\nYou can always use ${interaction.client.user} as a prefix too, even if you forget this one.`;
      await interaction.reply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const newPrefix = requestedPrefix.trim();
    if (!newPrefix || newPrefix.length > 5 || /\s/.test(newPrefix)) {
      await interaction.reply({ content: 'Prefix must be 1 to 5 characters and cannot contain spaces.', flags: MessageFlags.Ephemeral });
      return;
    }

    await updateGuild(interaction.guild.id, { prefix: newPrefix });
    setCachedPrefix(interaction.guild.id, newPrefix);

    await interaction.reply({ components: [textCard(`${EMOJI.APPROVE}  Prefix set to \`${newPrefix}\`.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  },
};
