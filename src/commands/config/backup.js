const {
  ActionRowBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createBackup, listBackups, getBackup, recordAudit, listAudit, vault } = require('../../db/backups');
const { restoreBackup } = require('../../utils/backupRestore');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, currentLanguage, languageOf, defaultText } = require('../../i18n');

const LOADING_EMOJI = EMOJI.LOADING;
const BACKUP_MENU_PREFIX = 'backup_menu';
const BACKUP_MENU_FLAGS = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

module.exports = {
  aliases: ['backups', 'serverbackup'],
  prefixDefaultSubcommand: 'panel',
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Create, export and restore a safe snapshot of this server configuration.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('panel').setDescription('Open the interactive Petto Vault backup menu.'))
    .addSubcommand((sub) => sub.setName('create').setDescription('Save roles, channels, permissions, emojis and server settings.').addStringOption((opt) => opt.setName('label').setDescription('Optional name for this backup').setMaxLength(80).setRequired(false)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List the latest saved backups for this server.'))
    .addSubcommand((sub) => sub.setName('export').setDescription('Download a backup as a JSON file.').addIntegerOption((opt) => opt.setName('id').setDescription('Server backup number, or omit it for the latest one').setMinValue(1).setRequired(false)))
    .addSubcommand((sub) => sub.setName('restore').setDescription('Restore a snapshot. Administrator and confirmation required.').addIntegerOption((opt) => opt.setName('id').setDescription('Server backup number to restore').setMinValue(1).setRequired(true)).addBooleanOption((opt) => opt.setName('confirm').setDescription('Confirm the restore and create a safety backup first').setRequired(true)).addStringOption((opt) => opt.setName('mode').setDescription('Merge without deleting, or replace extra resources').addChoices({ name: 'Merge (safe)', value: 'merge' }, { name: 'Replace (deletes extras)', value: 'replace' }).setRequired(false)))
    .addSubcommand((sub) => sub.setName('schedule').setDescription('Create automatic backups.').addIntegerOption((opt) => opt.setName('hours').setDescription('Hours between backups').setMinValue(1).setMaxValue(168).setRequired(true)).addIntegerOption((opt) => opt.setName('retention').setDescription('Scheduled backups to keep').setMinValue(1).setMaxValue(30).setRequired(false)))
    .addSubcommand((sub) => sub.setName('unschedule').setDescription('Disable automatic backups.'))
    .addSubcommand((sub) => sub.setName('audit').setDescription('Show the backup activity history.').addIntegerOption((opt) => opt.setName('limit').setDescription('Entries to show').setMinValue(1).setMaxValue(20).setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'panel') return openPanel(interaction);
    if (sub === 'create') return create(interaction);
    if (sub === 'export') return exportBackup(interaction);
    if (sub === 'restore') return restore(interaction);
    if (sub === 'schedule') return schedule(interaction);
    if (sub === 'unschedule') return unschedule(interaction);
    if (sub === 'audit') return audit(interaction);
    return list(interaction);
  },
};

async function openPanel(interaction) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.panel'), lang);
  const [rows, scheduleRow] = await Promise.all([
    listBackups(interaction.guild.id, 10),
    vault.isConfigured() ? vault.getSchedule(interaction.guild.id) : Promise.resolve(null),
  ]);
  await finish(interaction, buildPanel(interaction.guild, interaction.user.id, rows, scheduleRow, lang));
}

async function create(interaction) {
  const label = interaction.options?.getString?.('label')?.trim() || null;
  return createBackupForInteraction(interaction, label);
}

async function createBackupForInteraction(interaction, label = null) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.create'), lang);
  await fetchSnapshotResources(interaction.guild);
  const snapshot = buildSnapshot(interaction.guild);
  const saved = await createBackup(interaction.guild.id, interaction.user.id, label, snapshot);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_created', saved.backup_number, { source: saved.source || 'manual', label: saved.label });

  await finish(interaction, buildStatusCard([
    t(lang, 'backup.created.saved', { emoji: EMOJI.APPROVE, number: publicBackupNumber(saved) }),
    t(lang, 'backup.created.label', { label: backupLabel(saved, lang) }),
    t(lang, 'backup.created.captured', { roles: snapshot.roles.length, channels: snapshot.channels.length, emojis: snapshot.emojis.length }),
    t(lang, 'backup.created.note'),
  ].join('\n'), COLORS.GREEN, interaction, lang));
}

async function list(interaction) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.list'), lang);
  const rows = await listBackups(interaction.guild.id);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backups_listed', null, { count: rows.length });
  await finish(interaction, buildStatusCard(formatBackupList(rows, lang), COLORS.DEFAULT, interaction, lang));
}

async function exportBackup(interaction) {
  const requestedNumber = interaction.options?.getInteger?.('id') ?? null;
  return exportBackupForInteraction(interaction, requestedNumber);
}

async function exportBackupForInteraction(interaction, requestedNumber = null) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.export'), lang);
  const backup = await getBackup(interaction.guild.id, requestedNumber);
  if (!backup) {
    await finish(interaction, buildStatusCard(requestedNumber ? t(lang, 'backup.notFound', { number: requestedNumber }) : t(lang, 'backup.noneYet'), COLORS.RED, interaction, lang));
    return;
  }

  const number = publicBackupNumber(backup);
  const file = new AttachmentBuilder(Buffer.from(JSON.stringify(backup.snapshot, null, 2), 'utf8'), {
    name: `petto-backup-${interaction.guild.id}-${number}.json`,
  });
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_exported', number, { source: backup.source || 'manual' });
  await finish(interaction, buildStatusCard(t(lang, 'backup.exportReady', { emoji: EMOJI.APPROVE, number }), COLORS.GREEN, interaction, lang), { files: [file] });
}

async function restore(interaction) {
  const backupNumber = interaction.options.getInteger('id', true);
  const mode = interaction.options.getString('mode') || 'merge';
  const confirmed = interaction.options.getBoolean('confirm', true);
  return restoreBackupForInteraction(interaction, { backupNumber, mode, confirmed });
}

async function restoreBackupForInteraction(interaction, { backupNumber, mode = 'merge', confirmed = false }) {
  const lang = await languageOf(interaction);
  if (!interaction.member?.permissions?.has?.('Administrator')) {
    await replyStatus(interaction, t(lang, 'backup.restore.adminOnly', { emoji: EMOJI.DENY }), COLORS.RED);
    return;
  }
  if (!['merge', 'replace'].includes(mode)) {
    await replyStatus(interaction, t(lang, 'backup.restore.badMode', { emoji: EMOJI.WARNING }), COLORS.YELLOW);
    return;
  }

  await beginOperation(interaction, t(lang, 'backup.loading.restore'), lang);
  const backup = await getBackup(interaction.guild.id, backupNumber);
  if (!backup) {
    await finish(interaction, buildStatusCard(t(lang, 'backup.notFound', { number: backupNumber }), COLORS.RED, interaction, lang));
    return;
  }

  const number = publicBackupNumber(backup);
  if (!confirmed) {
    await finish(interaction, buildStatusCard([
      t(lang, 'backup.restore.ready', { emoji: EMOJI.WARNING, number, mode }),
      t(lang, 'backup.restore.contains', { roles: backup.snapshot.roles?.length ?? 0, channels: backup.snapshot.channels?.length ?? 0, emojis: backup.snapshot.emojis?.length ?? 0 }),
      t(lang, 'backup.restore.confirmHint'),
      t(lang, 'backup.restore.replaceWarning'),
    ].join('\n'), COLORS.YELLOW, interaction, lang));
    return;
  }

  await fetchSnapshotResources(interaction.guild);
  const safety = await createBackup(interaction.guild.id, interaction.user.id, t(lang, 'backup.restore.safetyLabel', { number }), buildSnapshot(interaction.guild), 'manual');
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_created', publicBackupNumber(safety), {
    source: 'manual',
    purpose: 'restore_safety',
    beforeBackupNumber: number,
  });
  const result = await restoreBackup(interaction.guild, backup.snapshot, { mode, reason: t(lang, 'backup.restore.reason', { number, user: interaction.user.tag ?? interaction.user.username }) });
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_restored', number, { mode, safetyBackupNumber: publicBackupNumber(safety), result });

  const failed = result.roles.failed + result.channels.failed + result.emojis.failed + result.errors.length;
  const details = t(lang, mode === 'replace' ? 'backup.restore.detailsReplace' : 'backup.restore.details', {
    rolesCreated: result.roles.created,
    rolesUpdated: result.roles.updated,
    channelsCreated: result.channels.created,
    channelsUpdated: result.channels.updated,
    emojisCreated: result.emojis.created,
    emojisUpdated: result.emojis.updated,
    deletedChannels: result.deleted.channels,
    deletedRoles: result.deleted.roles,
  });
  await finish(interaction, buildStatusCard([
    failed ? t(lang, 'backup.restore.warnings', { emoji: EMOJI.WARNING }) : t(lang, 'backup.restore.done', { emoji: EMOJI.APPROVE }),
    t(lang, 'backup.restore.summary', { number, mode, safety: publicBackupNumber(safety) }),
    details,
    failed ? result.errors.slice(0, 5).map((error) => `• ${error}`).join('\n') : '',
  ].filter(Boolean).join('\n\n'), failed ? COLORS.YELLOW : COLORS.GREEN, interaction, lang));
}

async function schedule(interaction) {
  const hours = interaction.options.getInteger('hours', true);
  const retention = interaction.options.getInteger('retention') ?? 7;
  return scheduleForInteraction(interaction, { hours, retention });
}

async function scheduleForInteraction(interaction, { hours, retention = 7 }) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.schedule'), lang);
  if (!vault.isConfigured()) {
    await finish(interaction, buildStatusCard(t(lang, 'backup.vault.notConnected'), COLORS.RED, interaction, lang));
    return;
  }

  const row = await vault.upsertSchedule(interaction.guild.id, hours, retention, interaction.user.id);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'schedule_updated', null, { intervalHours: hours, retentionCount: retention });
  await finish(interaction, buildStatusCard([
    t(lang, 'backup.schedule.enabled', { emoji: EMOJI.APPROVE, hours }),
    t(lang, 'backup.schedule.keeping', { retention }),
    t(lang, 'backup.schedule.next', { time: `<t:${Math.floor(new Date(row.next_run_at).getTime() / 1000)}:R>` }),
  ].join('\n'), COLORS.GREEN, interaction, lang));
}

async function unschedule(interaction) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.unschedule'), lang);
  if (!vault.isConfigured()) {
    await finish(interaction, buildStatusCard(t(lang, 'backup.vault.notConnectedShort'), COLORS.RED, interaction, lang));
    return;
  }

  const removed = await vault.removeSchedule(interaction.guild.id);
  if (removed) await recordBackupAudit(interaction.guild.id, interaction.user.id, 'schedule_disabled');
  await finish(interaction, buildStatusCard(removed ? t(lang, 'backup.schedule.disabled', { emoji: EMOJI.APPROVE }) : t(lang, 'backup.schedule.none'), removed ? COLORS.GREEN : COLORS.DEFAULT, interaction, lang));
}

async function audit(interaction) {
  const requestedLimit = interaction.options?.getInteger?.('limit') ?? 10;
  return auditForInteraction(interaction, requestedLimit);
}

async function auditForInteraction(interaction, limit = 10) {
  const lang = await languageOf(interaction);
  await beginOperation(interaction, t(lang, 'backup.loading.audit'), lang);
  const rows = await listAudit(interaction.guild.id, limit);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_audit_viewed', null, { count: rows.length });
  const content = rows.length
    ? [t(lang, 'backup.audit.title'), ...rows.map((row) => `• **${formatAuditAction(row.action, lang)}** · <@${row.actor_id}>${row.backup_number ? ` · ${t(lang, 'backup.audit.backupNumber', { number: row.backup_number })}` : ''} · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`)].join('\n')
    : t(lang, 'backup.audit.empty', { emoji: EMOJI.STAR });
  await finish(interaction, buildStatusCard(content, COLORS.DEFAULT, interaction, lang));
}

async function fetchSnapshotResources(guild) {
  await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.emojis.fetch()]);
}

async function beginOperation(interaction, text, lang = currentLanguage()) {
  const payload = { components: [loadingCard(text, lang)], flags: BACKUP_MENU_FLAGS };
  if (interaction.isMessageComponent?.()) {
    await interaction.update(payload);
    return;
  }
  await interaction.deferReply({ flags: BACKUP_MENU_FLAGS });
  await interaction.editReply(payload);
}

async function finish(interaction, card, extra = {}) {
  await interaction.editReply({ ...extra, components: [card], flags: BACKUP_MENU_FLAGS });
}

async function replyStatus(interaction, content, color) {
  await interaction.reply({ components: [textCard(content, color)], flags: BACKUP_MENU_FLAGS });
}

async function recordBackupAudit(guildId, actorId, action, backupNumber = null, metadata = {}) {
  try {
    await recordAudit(guildId, actorId, action, backupNumber, metadata);
  } catch (error) {
    logger.warn(`Backup audit write failed for guild ${guildId}:`, error.message);
  }
}

function loadingCard(text, lang = currentLanguage()) {
  return textCard(t(lang, 'backup.loading.card', { emoji: LOADING_EMOJI, text }), COLORS.DEFAULT);
}

function buildStatusCard(content, color, interaction, lang = currentLanguage()) {
  const card = textCard(content, color);
  if (interaction) card.addActionRowComponents(buildBackupMenuRow(interaction.guild.id, interaction.user.id, lang));
  return card;
}

/** The name of a backup: the one given to it, or the database's default ("Manual backup", "Scheduled backup") in `lang`. */
function backupLabel(row, lang = currentLanguage()) {
  if (!row?.label) return t(lang, 'backup.manualLabel');
  return defaultText(lang, defaultText(lang, row.label, 'backup.manualLabel'), 'backup.scheduledLabel');
}

/** One saved backup in a list: number, label, automatic or manual, and when. */
function backupLine(row, lang) {
  return `• **#${publicBackupNumber(row)}** ${backupLabel(row, lang)} · ${t(lang, row.source === 'scheduled' ? 'backup.source.automatic' : 'backup.source.manual')} · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`;
}

function buildPanel(guild, userId, rows, scheduleRow, lang = currentLanguage()) {
  const recent = rows.length
    ? rows.slice(0, 5).map((row) => backupLine(row, lang)).join('\n')
    : t(lang, 'backup.panel.empty');
  const scheduleText = scheduleRow
    ? t(lang, 'backup.panel.schedule', { hours: scheduleRow.interval_hours, retention: scheduleRow.retention_count, time: `<t:${Math.floor(new Date(scheduleRow.next_run_at).getTime() / 1000)}:R>` })
    : t(lang, vault.isConfigured() ? 'backup.panel.noSchedule' : 'backup.panel.needsVault');

  return new ContainerBuilder()
    .setAccentColor(COLORS.DEFAULT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      t(lang, 'backup.panel.title', { emoji: EMOJI.STAR }),
      t(lang, 'backup.panel.intro', { server: guild.name }),
      '',
      t(lang, 'backup.panel.recent'),
      recent,
      '',
      `${t(lang, 'backup.panel.scheduleHeading')}\n${scheduleText}`,
      '',
      t(lang, 'backup.panel.footer'),
    ].join('\n')))
    .addActionRowComponents(buildBackupMenuRow(guild.id, userId, lang));
}

function buildBackupMenuRow(guildId, userId, lang = currentLanguage()) {
  const option = (key, value) => ({ label: t(lang, `backup.menu.${key}.menu`), value, description: t(lang, `backup.menu.${key}.description.menu`) });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${BACKUP_MENU_PREFIX}:${guildId}:${userId}`)
      .setPlaceholder(t(lang, 'backup.menu.placeholder.menu'))
      .addOptions(
        option('create', 'create'),
        option('list', 'list'),
        option('exportLatest', 'export_latest'),
        option('restore', 'restore'),
        option('schedule', 'schedule'),
        option('audit', 'audit'),
      ),
  );
}

function formatBackupList(rows, lang = currentLanguage()) {
  if (!rows.length) return t(lang, 'backup.list.empty', { emoji: EMOJI.STAR });
  return [t(lang, 'backup.list.title'), ...rows.map((row) => backupLine(row, lang)), '', t(lang, 'backup.list.footer')].join('\n');
}

const AUDIT_ACTIONS = ['backup_created', 'backups_listed', 'backup_exported', 'backup_restored', 'backups_pruned', 'backup_audit_viewed', 'schedule_updated', 'schedule_disabled'];

function formatAuditAction(action, lang = currentLanguage()) {
  return AUDIT_ACTIONS.includes(action) ? t(lang, `backup.audit.action.${action}`) : action;
}

function publicBackupNumber(row) {
  return row.backup_number ?? row.id;
}

function buildSnapshot(guild) {
  return {
    format: 'petto-server-backup',
    version: 2,
    capturedAt: new Date().toISOString(),
    guild: {
      id: guild.id,
      name: guild.name,
      iconURL: guild.iconURL({ extension: 'png', size: 1024 }),
      bannerURL: guild.bannerURL({ extension: 'png', size: 1024 }),
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      afkTimeout: guild.afkTimeout,
      afkChannelId: guild.afkChannelId,
      systemChannelId: guild.systemChannelId,
    },
    roles: [...guild.roles.cache.values()]
      .filter((role) => !role.managed)
      .sort((a, b) => a.position - b.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, position: role.position, permissions: role.permissions.bitfield.toString() })),
    channels: [...guild.channels.cache.values()]
      .filter((channel) => !channel.isThread?.())
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.position,
        topic: 'topic' in channel ? channel.topic : null,
        nsfw: 'nsfw' in channel ? channel.nsfw : false,
        rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0,
        bitrate: 'bitrate' in channel ? channel.bitrate : null,
        userLimit: 'userLimit' in channel ? channel.userLimit : null,
        rtcRegion: 'rtcRegion' in channel ? channel.rtcRegion : null,
        videoQualityMode: 'videoQualityMode' in channel ? channel.videoQualityMode : null,
        defaultAutoArchiveDuration: 'defaultAutoArchiveDuration' in channel ? channel.defaultAutoArchiveDuration : null,
        defaultThreadRateLimitPerUser: 'defaultThreadRateLimitPerUser' in channel ? channel.defaultThreadRateLimitPerUser : null,
        permissionOverwrites: channel.permissionOverwrites?.cache.map((overwrite) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() })) ?? [],
      })),
    emojis: [...guild.emojis.cache.values()].map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated, url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 256 }) })),
  };
}

function buildScheduleModal(guildId, userId, lang = currentLanguage()) {
  return new ModalBuilder()
    .setCustomId(`backup_schedule_modal:${guildId}:${userId}`)
    .setTitle(t(lang, 'backup.schedule.modal.title'))
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hours').setLabel(t(lang, 'backup.schedule.modal.hours')).setStyle(TextInputStyle.Short).setRequired(true).setValue('24')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('retention').setLabel(t(lang, 'backup.schedule.modal.retention')).setStyle(TextInputStyle.Short).setRequired(true).setValue('7')),
    );
}

function buildRestoreModal(guildId, userId, lang = currentLanguage()) {
  return new ModalBuilder()
    .setCustomId(`backup_restore_modal:${guildId}:${userId}`)
    .setTitle(t(lang, 'backup.restore.modal.title'))
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('backup_number').setLabel(t(lang, 'backup.restore.modal.number')).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(t(lang, 'backup.restore.modal.example'))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mode').setLabel(t(lang, 'backup.restore.modal.mode')).setStyle(TextInputStyle.Short).setRequired(true).setValue('merge')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('confirm').setLabel(t(lang, 'backup.restore.modal.confirm')).setStyle(TextInputStyle.Short).setRequired(true)),
    );
}

module.exports.buildSnapshot = buildSnapshot;
module.exports.buildBackupMenuRow = buildBackupMenuRow;
module.exports.buildPanel = buildPanel;
module.exports.buildScheduleModal = buildScheduleModal;
module.exports.buildRestoreModal = buildRestoreModal;
module.exports.createBackupForInteraction = createBackupForInteraction;
module.exports.exportBackupForInteraction = exportBackupForInteraction;
module.exports.restoreBackupForInteraction = restoreBackupForInteraction;
module.exports.scheduleForInteraction = scheduleForInteraction;
module.exports.auditForInteraction = auditForInteraction;
module.exports.executeListFromMenu = list;
module.exports.BACKUP_MENU_PREFIX = BACKUP_MENU_PREFIX;
module.exports.LOADING_EMOJI = LOADING_EMOJI;
