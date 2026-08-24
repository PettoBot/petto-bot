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
  await beginOperation(interaction, 'Loading your backup center...');
  const [rows, scheduleRow] = await Promise.all([
    listBackups(interaction.guild.id, 10),
    vault.isConfigured() ? vault.getSchedule(interaction.guild.id) : Promise.resolve(null),
  ]);
  await finish(interaction, buildPanel(interaction.guild, interaction.user.id, rows, scheduleRow));
}

async function create(interaction) {
  const label = interaction.options?.getString?.('label')?.trim() || null;
  return createBackupForInteraction(interaction, label);
}

async function createBackupForInteraction(interaction, label = null) {
  await beginOperation(interaction, 'Creating a complete server configuration backup...');
  await fetchSnapshotResources(interaction.guild);
  const snapshot = buildSnapshot(interaction.guild);
  const saved = await createBackup(interaction.guild.id, interaction.user.id, label, snapshot);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_created', saved.backup_number, { source: saved.source || 'manual', label: saved.label });

  await finish(interaction, buildStatusCard([
    `${EMOJI.APPROVE} Backup **#${publicBackupNumber(saved)}** saved successfully.`,
    `**Label:** ${saved.label || 'Manual backup'}`,
    `**Captured:** ${snapshot.roles.length} roles · ${snapshot.channels.length} channels · ${snapshot.emojis.length} emojis`,
    'Configuration only is stored. Petto never stores bot tokens, passwords, or secrets in a backup.',
  ].join('\n'), COLORS.GREEN, interaction));
}

async function list(interaction) {
  await beginOperation(interaction, 'Loading saved backups...');
  const rows = await listBackups(interaction.guild.id);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backups_listed', null, { count: rows.length });
  await finish(interaction, buildStatusCard(formatBackupList(rows), COLORS.DEFAULT, interaction));
}

async function exportBackup(interaction) {
  const requestedNumber = interaction.options?.getInteger?.('id') ?? null;
  return exportBackupForInteraction(interaction, requestedNumber);
}

async function exportBackupForInteraction(interaction, requestedNumber = null) {
  await beginOperation(interaction, 'Preparing the backup export...');
  const backup = await getBackup(interaction.guild.id, requestedNumber);
  if (!backup) {
    await finish(interaction, buildStatusCard(requestedNumber ? `Backup **#${requestedNumber}** was not found in this server.` : 'No backups have been saved yet. Use `!backup create` first.', COLORS.RED, interaction));
    return;
  }

  const number = publicBackupNumber(backup);
  const file = new AttachmentBuilder(Buffer.from(JSON.stringify(backup.snapshot, null, 2), 'utf8'), {
    name: `petto-backup-${interaction.guild.id}-${number}.json`,
  });
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_exported', number, { source: backup.source || 'manual' });
  await finish(interaction, buildStatusCard(`${EMOJI.APPROVE} Backup **#${number}** is ready to download.`, COLORS.GREEN, interaction), { files: [file] });
}

async function restore(interaction) {
  const backupNumber = interaction.options.getInteger('id', true);
  const mode = interaction.options.getString('mode') || 'merge';
  const confirmed = interaction.options.getBoolean('confirm', true);
  return restoreBackupForInteraction(interaction, { backupNumber, mode, confirmed });
}

async function restoreBackupForInteraction(interaction, { backupNumber, mode = 'merge', confirmed = false }) {
  if (!interaction.member?.permissions?.has?.('Administrator')) {
    await replyStatus(interaction, `${EMOJI.DENY} Only server Administrators can restore a backup.`, COLORS.RED);
    return;
  }
  if (!['merge', 'replace'].includes(mode)) {
    await replyStatus(interaction, `${EMOJI.WARNING} Restore mode must be \`merge\` or \`replace\`.`, COLORS.YELLOW);
    return;
  }

  await beginOperation(interaction, 'Checking the restore and preparing a safety backup...');
  const backup = await getBackup(interaction.guild.id, backupNumber);
  if (!backup) {
    await finish(interaction, buildStatusCard(`Backup **#${backupNumber}** was not found in this server.`, COLORS.RED, interaction));
    return;
  }

  const number = publicBackupNumber(backup);
  if (!confirmed) {
    await finish(interaction, buildStatusCard([
      `${EMOJI.WARNING} Restore **#${number}** is ready in **${mode}** mode.`,
      `It contains **${backup.snapshot.roles?.length ?? 0} roles**, **${backup.snapshot.channels?.length ?? 0} channels**, and **${backup.snapshot.emojis?.length ?? 0} emojis**.`,
      'A safety backup is always created first. To continue, confirm with `CONFIRM` in the menu or use the prefix command with `true`.',
      '**Replace mode deletes channels and roles that are not in the snapshot.**',
    ].join('\n'), COLORS.YELLOW, interaction));
    return;
  }

  await fetchSnapshotResources(interaction.guild);
  const safety = await createBackup(interaction.guild.id, interaction.user.id, `Before restoring backup #${number}`, buildSnapshot(interaction.guild), 'manual');
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_created', publicBackupNumber(safety), {
    source: 'manual',
    purpose: 'restore_safety',
    beforeBackupNumber: number,
  });
  const result = await restoreBackup(interaction.guild, backup.snapshot, { mode, reason: `Petto backup #${number} restored by ${interaction.user.tag ?? interaction.user.username}` });
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_restored', number, { mode, safetyBackupNumber: publicBackupNumber(safety), result });

  const failed = result.roles.failed + result.channels.failed + result.emojis.failed + result.errors.length;
  const details = `Roles: **${result.roles.created} created**, **${result.roles.updated} updated** · Channels: **${result.channels.created} created**, **${result.channels.updated} updated** · Emojis: **${result.emojis.created} created**, **${result.emojis.updated} updated**${mode === 'replace' ? ` · Deleted: **${result.deleted.channels} channels**, **${result.deleted.roles} roles**` : ''}`;
  await finish(interaction, buildStatusCard([
    `${failed ? EMOJI.WARNING : EMOJI.APPROVE} ${failed ? 'Restore finished with warnings.' : 'Backup restored.'}`,
    `Backup **#${number}** restored in **${mode}** mode. Safety backup: **#${publicBackupNumber(safety)}**.`,
    details,
    failed ? result.errors.slice(0, 5).map((error) => `• ${error}`).join('\n') : '',
  ].filter(Boolean).join('\n\n'), failed ? COLORS.YELLOW : COLORS.GREEN, interaction));
}

async function schedule(interaction) {
  const hours = interaction.options.getInteger('hours', true);
  const retention = interaction.options.getInteger('retention') ?? 7;
  return scheduleForInteraction(interaction, { hours, retention });
}

async function scheduleForInteraction(interaction, { hours, retention = 7 }) {
  await beginOperation(interaction, 'Saving the automatic backup schedule...');
  if (!vault.isConfigured()) {
    await finish(interaction, buildStatusCard('Petto Vault is not connected yet. Add `PETTO_VAULT_DATABASE_URL` to the bot environment first.', COLORS.RED, interaction));
    return;
  }

  const row = await vault.upsertSchedule(interaction.guild.id, hours, retention, interaction.user.id);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'schedule_updated', null, { intervalHours: hours, retentionCount: retention });
  await finish(interaction, buildStatusCard([
    `${EMOJI.APPROVE} Automatic backups enabled every **${hours}h**.`,
    `Keeping the latest **${retention}** scheduled backups.`,
    `Next run: <t:${Math.floor(new Date(row.next_run_at).getTime() / 1000)}:R>`,
  ].join('\n'), COLORS.GREEN, interaction));
}

async function unschedule(interaction) {
  await beginOperation(interaction, 'Disabling automatic backups...');
  if (!vault.isConfigured()) {
    await finish(interaction, buildStatusCard('Petto Vault is not connected yet.', COLORS.RED, interaction));
    return;
  }

  const removed = await vault.removeSchedule(interaction.guild.id);
  if (removed) await recordBackupAudit(interaction.guild.id, interaction.user.id, 'schedule_disabled');
  await finish(interaction, buildStatusCard(removed ? `${EMOJI.APPROVE} Automatic backups disabled.` : 'This server had no automatic backup schedule.', removed ? COLORS.GREEN : COLORS.DEFAULT, interaction));
}

async function audit(interaction) {
  const requestedLimit = interaction.options?.getInteger?.('limit') ?? 10;
  return auditForInteraction(interaction, requestedLimit);
}

async function auditForInteraction(interaction, limit = 10) {
  await beginOperation(interaction, 'Loading the backup activity history...');
  const rows = await listAudit(interaction.guild.id, limit);
  await recordBackupAudit(interaction.guild.id, interaction.user.id, 'backup_audit_viewed', null, { count: rows.length });
  const content = rows.length
    ? ['### Backup activity', ...rows.map((row) => `• **${formatAuditAction(row.action)}** · <@${row.actor_id}>${row.backup_number ? ` · backup #${row.backup_number}` : ''} · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`)].join('\n')
    : `${EMOJI.STAR} No backup activity has been recorded yet.`;
  await finish(interaction, buildStatusCard(content, COLORS.DEFAULT, interaction));
}

async function fetchSnapshotResources(guild) {
  await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.emojis.fetch()]);
}

async function beginOperation(interaction, text) {
  const payload = { components: [loadingCard(text)], flags: BACKUP_MENU_FLAGS };
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

function loadingCard(text) {
  return textCard(`${LOADING_EMOJI} **${text}**\nPlease wait while Petto finishes this operation.`, COLORS.DEFAULT);
}

function buildStatusCard(content, color, interaction) {
  const card = textCard(content, color);
  if (interaction) card.addActionRowComponents(buildBackupMenuRow(interaction.guild.id, interaction.user.id));
  return card;
}

function buildPanel(guild, userId, rows, scheduleRow) {
  const recent = rows.length
    ? rows.slice(0, 5).map((row) => `• **#${publicBackupNumber(row)}** ${row.label || 'Manual backup'} · ${row.source === 'scheduled' ? 'automatic' : 'manual'} · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`).join('\n')
    : 'No backups saved yet. Choose **Create backup** below.';
  const scheduleText = scheduleRow
    ? `Every **${scheduleRow.interval_hours}h** · keeping **${scheduleRow.retention_count}** scheduled backups · next <t:${Math.floor(new Date(scheduleRow.next_run_at).getTime() / 1000)}:R>`
    : vault.isConfigured() ? 'No automatic schedule is active.' : 'Automatic schedules need Petto Vault to be connected.';

  return new ContainerBuilder()
    .setAccentColor(COLORS.DEFAULT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${EMOJI.STAR} **Petto Vault · Backup Center**`,
      `Manage configuration snapshots for **${guild.name}**. Visible backup numbers are private to this server; they do not use the global database ID.`,
      '',
      '**Recent backups**',
      recent,
      '',
      `**Automatic schedule**\n${scheduleText}`,
      '',
      'Choose an action from the menu below. Destructive restores always require Administrator confirmation and create a safety backup first.',
    ].join('\n')))
    .addActionRowComponents(buildBackupMenuRow(guild.id, userId));
}

function buildBackupMenuRow(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${BACKUP_MENU_PREFIX}:${guildId}:${userId}`)
      .setPlaceholder('Choose a backup action...')
      .addOptions(
        { label: 'Create backup', value: 'create', description: 'Capture the current server configuration.' },
        { label: 'List backups', value: 'list', description: 'Show backups saved for this server.' },
        { label: 'Export latest', value: 'export_latest', description: 'Download the newest server backup as JSON.' },
        { label: 'Restore backup', value: 'restore', description: 'Restore a server backup with a safety copy first.' },
        { label: 'Automatic schedule', value: 'schedule', description: 'Set or update scheduled backups.' },
        { label: 'Activity history', value: 'audit', description: 'Review who created, exported, or restored backups.' },
      ),
  );
}

function formatBackupList(rows) {
  if (!rows.length) return `${EMOJI.STAR} No backups saved yet. Use \`!backup create\` or choose **Create backup** from the menu.`;
  return ['### Backups for this server', ...rows.map((row) => `• **#${publicBackupNumber(row)}** ${row.label || 'Manual backup'} · ${row.source === 'scheduled' ? 'automatic' : 'manual'} · <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`), '', 'Numbers start at 1 independently for each server.'].join('\n');
}

function formatAuditAction(action) {
  return ({
    backup_created: 'Backup created',
    backups_listed: 'Backups listed',
    backup_exported: 'Backup exported',
    backup_restored: 'Backup restored',
    backups_pruned: 'Scheduled backups pruned',
    backup_audit_viewed: 'Activity history viewed',
    schedule_updated: 'Schedule updated',
    schedule_disabled: 'Schedule disabled',
  })[action] ?? action;
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

function buildScheduleModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`backup_schedule_modal:${guildId}:${userId}`)
    .setTitle('Automatic backups')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('hours').setLabel('Hours between backups (1-168)').setStyle(TextInputStyle.Short).setRequired(true).setValue('24')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('retention').setLabel('Scheduled backups to keep (1-30)').setStyle(TextInputStyle.Short).setRequired(true).setValue('7')),
    );
}

function buildRestoreModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`backup_restore_modal:${guildId}:${userId}`)
    .setTitle('Restore a backup')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('backup_number').setLabel('Server backup number').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Example: 3')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mode').setLabel('Mode: merge or replace').setStyle(TextInputStyle.Short).setRequired(true).setValue('merge')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('confirm').setLabel('Type CONFIRM to continue').setStyle(TextInputStyle.Short).setRequired(true)),
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
