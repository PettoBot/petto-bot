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
  setMemberSettings,
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
const { t, tn, languageOf } = require('../../i18n');

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
      .setName('dm')
      .setDescription('Choose whether the caught member gets a DM and, for a softban, a single-use invite back.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('The configured honeypot channel.')
        .addChannelTypes(...CHANNEL_TYPES)
        .setRequired(true))
      .addBooleanOption((option) => option
        .setName('enabled')
        .setDescription('on: the caught member gets the sanction DM. off: nothing is sent.')
        .setRequired(true))
      .addBooleanOption((option) => option
        .setName('reinvite')
        .setDescription('For a softban: on adds an invite back (one use, 7 days) to the DM.')
        .setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List this server\'s configured honeypot channels.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') return addHoneypot(interaction, lang);
    if (subcommand === 'remove') return removeConfiguredHoneypot(interaction, lang);
    if (subcommand === 'panel') return configurePanel(interaction, lang);
    if (subcommand === 'dm') return configureMemberDM(interaction, lang);
    return listConfiguredHoneypots(interaction, lang);
  },
};

async function addHoneypot(interaction, lang) {
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
    await reply(interaction, t(lang, 'security.honeypot.add.permissions', {
      emoji: EMOJI.DENY,
      view: t(lang, 'core.perm.ViewChannel'),
      send: t(lang, 'core.perm.SendMessages'),
      history: t(lang, 'core.perm.ReadMessageHistory'),
      manage: t(lang, 'core.perm.ManageMessages'),
      channel: `${channel}`,
    }), 0xfe6465);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const row = await upsertHoneypot(interaction.guild.id, channel.id, punishment);
    const configured = await createOrUpdatePanel(interaction.client, channel, row, lang);
    const action = punishmentText(configured.punishment, lang);

    await interaction.editReply({
      components: [textCard(t(lang, 'security.honeypot.add.done', { emoji: EMOJI.APPROVE, channel: `${channel}`, action }), 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    logger.error('Honeypot configuration failed:', error);
    await interaction.editReply({
      components: [textCard(t(lang, 'security.honeypot.add.failed', { emoji: EMOJI.DENY }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
}

function panelModeText(row, lang) {
  const mode = row.panel_mode ?? 'default';
  if (mode === 'none') return t(lang, 'security.honeypot.mode.none');
  if (mode === 'custom') return row.panel_template ? t(lang, 'security.honeypot.mode.embed', { name: row.panel_template }) : t(lang, 'security.honeypot.mode.text');
  return t(lang, 'security.honeypot.mode.default');
}

async function configurePanel(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const mode = String(interaction.options.getString('mode', true)).trim().toLowerCase();
  const text = interaction.options.getString('text');
  const template = (interaction.options.getString('template') ?? '').trim();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const fail = (message) => interaction.editReply({ components: [textCard(message)], flags: MessageFlags.IsComponentsV2 });

  try {
    if (!['default', 'custom', 'none'].includes(mode)) return fail(t(lang, 'security.honeypot.panel.badMode'));
    const existing = await getHoneypot(interaction.guild.id, channel.id);
    if (!existing) return fail(t(lang, 'security.honeypot.panel.notHoneypot', { channel: `${channel}` }));

    const changes = { panel_mode: mode };
    if (text !== null) changes.panel_text = text.trim().toLowerCase() === 'none' ? '' : text.trim();
    if (template) {
      if (template.toLowerCase() === 'none') changes.panel_template = null;
      else if (!(await getTemplate(interaction.guild.id, template).catch(() => null))?.data) return fail(t(lang, 'security.honeypot.panel.noEmbed', { name: template }));
      else changes.panel_template = template;
    }
    if (mode === 'custom' && !(changes.panel_text ?? existing.panel_text) && !(('panel_template' in changes) ? changes.panel_template : existing.panel_template)) {
      return fail(t(lang, 'security.honeypot.panel.customEmpty'));
    }

    const row = await setPanelSettings(interaction.guild.id, channel.id, changes);
    invalidateHoneypotCache(interaction.guild.id);
    const configured = await createOrUpdatePanel(interaction.client, channel, row, lang);
    const summary = t(lang, `security.honeypot.panel.done.${mode}`, { emoji: EMOJI.APPROVE, what: panelModeText(configured, lang), channel: `${channel}` });
    return interaction.editReply({ components: [textCard(summary, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (error) {
    logger.error('Honeypot panel configuration failed:', error);
    return interaction.editReply({ components: [textCard(t(lang, 'security.honeypot.panel.failed', { emoji: EMOJI.DENY }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }
}

function memberDMText(row, lang) {
  if (row.dm_member === false) return t(lang, 'security.honeypot.dm.off');
  if (row.punishment !== 'softban') return t(lang, 'security.honeypot.dm.on');
  return t(lang, row.reinvite === false ? 'security.honeypot.dm.onNoInvite' : 'security.honeypot.dm.onInvite');
}

async function configureMemberDM(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const enabled = interaction.options.getBoolean('enabled', true);
  const reinvite = interaction.options.getBoolean('reinvite');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  try {
    const existing = await getHoneypot(interaction.guild.id, channel.id);
    if (!existing) {
      return interaction.editReply({ components: [textCard(t(lang, 'security.honeypot.panel.notHoneypot', { channel: `${channel}` }))], flags: MessageFlags.IsComponentsV2 });
    }
    const changes = { dm_member: Boolean(enabled) };
    if (reinvite !== null && reinvite !== undefined) changes.reinvite = Boolean(reinvite);
    const row = await setMemberSettings(interaction.guild.id, channel.id, changes);
    invalidateHoneypotCache(interaction.guild.id);
    const lines = [t(lang, 'security.honeypot.dm.done', { emoji: EMOJI.APPROVE, channel: `${channel}`, what: memberDMText(row, lang) })];
    if (row.dm_member !== false && row.punishment === 'softban' && row.reinvite !== false) {
      const me = interaction.guild.members.me;
      if (me && !me.permissions?.has?.(PermissionFlagsBits.CreateInstantInvite)) lines.push(t(lang, 'security.honeypot.dm.needInvite', { perm: t(lang, 'core.perm.CreateInstantInvite') }));
    }
    return interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (error) {
    logger.error('Honeypot DM configuration failed:', error);
    return interaction.editReply({ components: [textCard(t(lang, 'security.honeypot.dm.failed', { emoji: EMOJI.DENY }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }
}

async function removeConfiguredHoneypot(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const existing = await getHoneypot(interaction.guild.id, channel.id);
    if (!existing) {
      await interaction.editReply({
        components: [textCard(t(lang, 'security.honeypot.remove.missing', { emoji: EMOJI.WARNING, channel: `${channel}` }))],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await deletePanel(interaction.client, existing);
    await removeHoneypot(interaction.guild.id, channel.id);
    invalidateHoneypotCache(interaction.guild.id);

    await interaction.editReply({
      components: [textCard(t(lang, 'security.honeypot.remove.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }), 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    logger.error('Honeypot removal failed:', error);
    await interaction.editReply({
      components: [textCard(t(lang, 'security.honeypot.remove.failed', { emoji: EMOJI.DENY }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
}

async function listConfiguredHoneypots(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    const rows = await listHoneypots(interaction.guild.id);
    const line = (row) => tn(lang, 'security.honeypot.list.line', row.caught_count === 1 ? 1 : 0, {
      count: row.caught_count ?? 0,
      channel: `<#${row.channel_id}>`,
      action: punishmentText(row.punishment, lang),
      message: panelModeText(row, lang),
      dm: memberDMText(row, lang),
    });
    const content = rows.length
      ? [
        t(lang, 'security.honeypot.list.title'),
        ...rows.map(line),
        '',
        t(lang, 'security.honeypot.list.footer'),
      ].join('\n')
      : t(lang, 'security.honeypot.list.empty', { emoji: EMOJI.STAR });

    await interaction.editReply({
      components: [textCard(content)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    logger.error('Honeypot listing failed:', error);
    await interaction.editReply({
      components: [textCard(t(lang, 'security.honeypot.list.failed', { emoji: EMOJI.DENY }), 0xfe6465)],
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
