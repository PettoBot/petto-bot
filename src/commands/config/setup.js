const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  LabelBuilder,
  ChannelSelectMenuBuilder,
  RadioGroupBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { ensureGuild } = require('../../db/guilds');

module.exports = {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure Petto for this server with one setup form.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const guildConfig = await ensureGuild(interaction.guild.id);
    const prefix = guildConfig.prefix || '!';

    const modal = new ModalBuilder()
      .setCustomId('petto_setup_modal')
      .setTitle('Petto Setup')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Log Channel')
          .setDescription('Where Petto should send audit, moderation and automod logs.')
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId('setup_log_channel')
              .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setMinValues(0)
              .setMaxValues(1)
              .setRequired(false),
          ),
        new LabelBuilder()
          .setLabel('Welcome Channel')
          .setDescription('Where Petto should post the default member welcome message.')
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId('setup_welcome_channel')
              .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setMinValues(0)
              .setMaxValues(1)
              .setRequired(false),
          ),
        new LabelBuilder()
          .setLabel('Moderation Mode')
          .setDescription('Choose the default level for local anti-spam and join protection.')
          .setRadioGroupComponent(
            new RadioGroupBuilder()
              .setCustomId('setup_moderation_mode')
              .setRequired(true)
              .addOptions(
                { label: 'Balanced', value: 'balanced', description: 'Warns first and alerts on suspicious joins.', default: true },
                { label: 'Strict', value: 'strict', description: 'Enables automatic kicks for configured raid and alt checks.' },
                { label: 'Disabled', value: 'disabled', description: 'Leaves automatic moderation protections off.' },
              ),
          ),
        new LabelBuilder()
          .setLabel('Features')
          .setDescription('Select the modules to enable during this setup.')
          .setStringSelectMenuComponent(
            new StringSelectMenuBuilder()
              .setCustomId('setup_features')
              .setPlaceholder('Select features to enable')
              .setMinValues(0)
              .setMaxValues(5)
              .setRequired(false)
              .addOptions(
                { label: 'Audit logs', value: 'logs', description: 'Route Petto event logs to the selected log channel.' },
                { label: 'Welcome messages', value: 'welcome', description: 'Send a default message when members join.' },
                { label: 'Anti-spam', value: 'anti-spam', description: 'Detect flooding, mass mentions and invite spam.' },
                { label: 'Anti-raid', value: 'anti-raid', description: 'Detect bursts of new members joining.' },
                { label: 'Anti-alt', value: 'anti-alt', description: 'Flag or kick very new accounts.' },
              ),
          ),
        new LabelBuilder()
          .setLabel('Command Prefix')
          .setDescription('The prefix for Petto commands, up to five characters.')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('setup_prefix')
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(5)
              .setValue(prefix)
              .setRequired(true),
          ),
      );

    await interaction.showModal(modal);
  },
};
