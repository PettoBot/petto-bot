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
  upsertHoneypot,
} = require('../../db/honeypot');
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
      .setName('list')
      .setDescription('List this server\'s configured honeypot channels.')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') return addHoneypot(interaction);
    if (subcommand === 'remove') return removeConfiguredHoneypot(interaction);
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
        ...rows.map((row) => `• <#${row.channel_id}> · **${punishmentText(row.punishment)}** · **${row.caught_count ?? 0}** member${row.caught_count === 1 ? '' : 's'} caught`),
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
