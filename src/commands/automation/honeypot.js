const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const {
  getHoneypot,
  listHoneypots,
  removeHoneypot,
  setPanelSettings,
  upsertHoneypot,
} = require('../../db/honeypot');
const { getTemplate } = require('../../db/embedTemplates');
const {
  createOrUpdatePanel,
  deletePanel,
  invalidateHoneypotCache,
} = require('../../utils/honeypot');
const { punishmentText } = require('../../utils/honeypotPanel');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
  aliases: ['hp'],
  prefixOnly: true,
  data: new SlashCommandBuilder()
    .setName('honeypot')
    .setDescription('Catch spam bots in a bait channel and apply a moderation action.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Enable a honeypot channel and post its warning panel.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('The bait channel. Users should never post in it.')
        .addChannelTypes(...CHANNEL_TYPES)
        .setRequired(true))
      .addStringOption((option) => option
        .setName('punishment')
        .setDescription('Action taken when a non-staff member posts there.')
        .addChoices(
          { name: 'softban (recommended)', value: 'softban' },
          { name: 'ban', value: 'ban' },
          { name: 'kick', value: 'kick' },
        )
        .setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Disable a honeypot channel and remove its warning panel.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('The configured honeypot channel.')
        .addChannelTypes(...CHANNEL_TYPES)
        .setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('panel')
      .setDescription('Choose what is posted in a honeypot channel: Petto\'s panel, your own message, or nothing.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('The configured honeypot channel.')
        .addChannelTypes(...CHANNEL_TYPES)
        .setRequired(true))
      .addStringOption((option) => option
        .setName('mode')
        .setDescription('default (Petto\'s warning panel), custom (your text or saved embed) or none')
        .addChoices({ name: 'default', value: 'default' }, { name: 'custom', value: 'custom' }, { name: 'none', value: 'none' })
        .setRequired(true))
      .addStringOption((option) => option
        .setName('text')
        .setDescription('For custom: the text, with {honeypot.action}, {honeypot.count} and {honeypot.channel}.')
        .setMaxLength(2000)
        .setRequired(false))
      .addStringOption((option) => option
        .setName('template')
        .setDescription('For custom: the name of a saved embed to post, or "none" to stop using one.')
        .setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List this server\'s configured honeypot channels.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') return addHoneypot(interaction);
    if (subcommand === 'remove') return removeConfiguredHoneypot(interaction);
    if (subcommand === 'panel') return configurePanel(interaction);
    return listConfiguredHoneypots(interaction);
  },
};

async function addHoneypot(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const punishment = interaction.options.getString('punishment') ?? 'softban';
  const botMember = interaction.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
  ];

  if (!permissions?.has(required)) {
    await reply(interaction, `${EMOJI.DENY} I need **View Channel**, **Send Messages**, **Read Message History**, and **Manage Messages** in ${channel}.`, 0xfe6465);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const row = await upsertHoneypot(interaction.guild.id, channel.id, punishment);
    const configured = await createOrUpdatePanel(interaction.client, channel, row);
    const action = punishmentText(configured.punishment);

    await interaction.editReply({
      components: [textCard([
        `${EMOJI.APPROVE} Honeypot enabled in ${channel}.`,
        `**Action:** ${action} for non-staff members who post there.`,
        '**Repeat protection:** each member is actioned once while they remain in the server; later messages are removed without duplicate cases.',
        '**Staff exemption:** the server owner, Administrators, and members with Manage Messages.',
        'The warning panel is now posted in that channel. Use `!honeypot list` to view the trigger count.',
      ].join('\n'), 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    logger.error('Honeypot configuration failed:', error);
    await interaction.editReply({
      components: [textCard(`${EMOJI.DENY} I could not configure that honeypot right now. Check my channel permissions and try again.`, 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
}

function panelModeText(row) {
  const mode = row.panel_mode ?? 'default';
  if (mode === 'none') return 'none';
  if (mode === 'custom') return row.panel_template ? `saved embed \`${row.panel_template}\`` : 'your text';
  return 'Petto\'s panel';
}

async function configurePanel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const mode = String(interaction.options.getString('mode', true)).trim().toLowerCase();
  const text = interaction.options.getString('text');
  const template = (interaction.options.getString('template') ?? '').trim();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const fail = (message) => interaction.editReply({ components: [textCard(message, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });

  try {
    if (!['default', 'custom', 'none'].includes(mode)) return fail('The message is `default`, `custom` or `none`.');
    const existing = await getHoneypot(interaction.guild.id, channel.id);
    if (!existing) return fail(`${channel} is not a honeypot channel. Use \`!honeypot add\` first.`);

    const changes = { panel_mode: mode };
    if (text !== null) changes.panel_text = text.trim().toLowerCase() === 'none' ? '' : text.trim();
    if (template) {
      if (template.toLowerCase() === 'none') changes.panel_template = null;
      else if (!(await getTemplate(interaction.guild.id, template).catch(() => null))?.data) return fail(`There is no saved embed called \`${template}\`.`);
      else changes.panel_template = template;
    }
    if (mode === 'custom' && !(changes.panel_text ?? existing.panel_text) && !(('panel_template' in changes) ? changes.panel_template : existing.panel_template)) {
      return fail('For a custom message give a `text` or a saved `template`, otherwise Petto\'s panel would be posted.');
    }

    const row = await setPanelSettings(interaction.guild.id, channel.id, changes);
    invalidateHoneypotCache(interaction.guild.id);
    const configured = await createOrUpdatePanel(interaction.client, channel, row);
    const summary = { default: 'Petto\'s warning panel is posted in', custom: `${panelModeText(configured)} is posted in`, none: 'Nothing is posted in' }[mode];
    return interaction.editReply({ components: [textCard(`${EMOJI.APPROVE} ${summary} ${channel}. The honeypot still works the same.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (error) {
    logger.error('Honeypot panel configuration failed:', error);
    return interaction.editReply({ components: [textCard(`${EMOJI.DENY} I could not change that message right now. Check my permissions in the channel.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }
}

async function removeConfiguredHoneypot(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const existing = await getHoneypot(interaction.guild.id, channel.id);
    if (!existing) {
      await interaction.editReply({
        components: [textCard(`${EMOJI.WARNING} ${channel} is not configured as a honeypot.`, 0xfed53c)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await deletePanel(interaction.client, existing);
    await removeHoneypot(interaction.guild.id, channel.id);
    invalidateHoneypotCache(interaction.guild.id);

    await interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE} Honeypot disabled in ${channel}. Its warning panel was removed when possible.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    logger.error('Honeypot removal failed:', error);
    await interaction.editReply({
      components: [textCard(`${EMOJI.DENY} I could not remove that honeypot right now. Try again shortly.`, 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
}

async function listConfiguredHoneypots(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const rows = await listHoneypots(interaction.guild.id);
    const content = rows.length
      ? [
        '### Honeypot channels',
        ...rows.map((row) => `• <#${row.channel_id}> · **${punishmentText(row.punishment)}** · **${row.caught_count ?? 0}** member${row.caught_count === 1 ? '' : 's'} caught · message: ${panelModeText(row)}`),
        '',
        'The server owner, Administrators, and members with Manage Messages are exempt.',
      ].join('\n')
      : `${EMOJI.STAR} No honeypot channels are configured. Use \`!honeypot add #channel\` to create one.`;

    await interaction.editReply({
      components: [textCard(content, 0x4b4f59)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    logger.error('Honeypot listing failed:', error);
    await interaction.editReply({
      components: [textCard(`${EMOJI.DENY} I could not load the honeypot configuration right now.`, 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
}

async function reply(interaction, content, color) {
  return interaction.reply({
    components: [textCard(content, color)],
    flags: MessageFlags.IsComponentsV2,
  });
}
