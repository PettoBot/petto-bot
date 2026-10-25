const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild, updateGuild } = require('../../db/guilds');
const { setCachedPrefix } = require('../../events/messageCreateCommands');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { readPrefixInput, isValidPrefix } = require('../../utils/prefixInput');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['pfx'],
  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('View or change the command prefix.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('new_prefix').setDescription('New prefix, up to 5 characters').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const requestedPrefix = interaction.options.getString('new_prefix');
    const guildConfig = await ensureGuild(interaction.guild.id);

    if (requestedPrefix == null) {
      const text = t(lang, 'core.prefix.current', { prefix: guildConfig.prefix, bot: `${interaction.client.user}` });
      await interaction.reply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const newPrefix = readPrefixInput(requestedPrefix);
    if (!isValidPrefix(newPrefix)) {
      await interaction.reply({ content: t(lang, 'core.prefix.invalid'), flags: MessageFlags.Ephemeral });
      return;
    }

    await updateGuild(interaction.guild.id, { prefix: newPrefix });
    setCachedPrefix(interaction.guild.id, newPrefix);

    await interaction.reply({ components: [textCard(t(lang, 'core.prefix.set', { emoji: EMOJI.APPROVE, prefix: newPrefix }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  },
};
