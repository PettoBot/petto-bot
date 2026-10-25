const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createBackup, listBackups, getBackup, deleteBackup, deleteAllBackups, recordAudit, listAudit, vault } = require('../../db/backups');
const { planRestore } = require('../../utils/backupRestore');
const jobs = require('../../utils/backupJobs');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { backupsUnderMaintenance } = require('../../utils/maintenance');
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
    .addSubcommand((sub) => sub.setName('restore').setDescription('Restore a snapshot. Administrator and confirmation required.').addIntegerOption((opt) => opt.setName('id').setDescription('Server backup number to restore').setMinValue(1).setRequired(true)).addBooleanOption((opt) => opt.setName('confirm').setDescription('Not needed any more: Petto always asks you to confirm').setRequired(false)).addStringOption((opt) => opt.setName('mode').setDescription('Merge without deleting, or replace extra resources').addChoices({ name: 'Merge (safe)', value: 'merge' }, { name: 'Replace (deletes extras)', value: 'replace' }).setRequired(false)))
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete a backup, or all of them. Administrator and confirmation required.').addIntegerOption((opt) => opt.setName('id').setDescription('Server backup number to delete').setMinValue(1).setRequired(false)).addBooleanOption((opt) => opt.setName('all').setDescription('Delete every backup of this server and turn off automatic backups').setRequired(false)))
    .addSubcommand((sub) => sub.setName('schedule').setDescription('Create automatic backups.').addIntegerOption((opt) => opt.setName('hours').setDescription('Hours between backups').setMinValue(1).setMaxValue(168).setRequired(true)).addIntegerOption((opt) => opt.setName('retention').setDescription('Scheduled backups to keep').setMinValue(1).setMaxValue(30).setRequired(false)))
    .addSubcommand((sub) => sub.setName('unschedule').setDescription('Disable automatic backups.'))
    .addSubcommand((sub) => sub.setName('audit').setDescription('Show the backup activity history.').addIntegerOption((opt) => opt.setName('limit').setDescription('Entries to show').setMinValue(1).setMaxValue(20).setRequired(false))),

  async execute(interaction) {
    if (backupsUnderMaintenance(interaction.user.id)) return replyMaintenance(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'panel') return openPanel(interaction);
    if (sub === 'create') return create(interaction);
    if (sub === 'export') return exportBackup(interaction);
    if (sub === 'restore') return restore(interaction);
    if (sub === 'delete') return deleteCommand(interaction);
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
  const snapshot = await buildFullSnapshot(interaction.guild);
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
  return restoreBackupForInteraction(interaction, { backupNumber, mode });
}


const DELETE_PREFIX = 'backup_delete';
const deleteId = (action, guildId, userId, target) => `${DELETE_PREFIX}:${action}:${guildId}:${userId}:${target}`;

async function deleteCommand(interaction) {
  const all = interaction.options.getBoolean('all') === true;
  const backupNumber = interaction.options.getInteger('id');
  return deleteBackupsForInteraction(interaction, { backupNumber, all });
}

/** Step one of deleting: says what would be deleted and asks. Nothing is deleted here. */
async function deleteBackupsForInteraction(interaction, { backupNumber = null, all = false }) {
  const lang = await languageOf(interaction);
  if (!interaction.member?.permissions?.has?.('Administrator')) {
    await replyStatus(interaction, t(lang, 'backup.delete.adminOnly', { emoji: EMOJI.DENY }), COLORS.RED);
    return;
  }
  if (!all && !Number.isInteger(backupNumber)) {
    await replyStatus(interaction, t(lang, 'backup.delete.invalid', { emoji: EMOJI.WARNING }), COLORS.YELLOW);
    return;
  }
  await beginOperation(interaction, t(lang, 'backup.loading.list'), lang);
  let text;
  let target;
  if (all) {
    const rows = await listBackups(interaction.guild.id, 500);
    if (!rows.length) {
      await finish(interaction, buildStatusCard(t(lang, 'backup.noneYet'), COLORS.DEFAULT, interaction, lang));
      return;
    }
    text = t(lang, 'backup.delete.confirmAll', { emoji: EMOJI.ALERT, count: rows.length });
    target = 'all';
  } else {
    const backup = await getBackup(interaction.guild.id, backupNumber);
    if (!backup) {
      await finish(interaction, buildStatusCard(t(lang, 'backup.notFound', { number: backupNumber }), COLORS.RED, interaction, lang));
      return;
    }
    text = t(lang, 'backup.delete.confirmOne', { emoji: EMOJI.ALERT, number: publicBackupNumber(backup) });
    target = String(publicBackupNumber(backup));
  }
  const card = textCard(text, COLORS.RED);
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(deleteId('yes', interaction.guild.id, interaction.user.id, target)).setLabel(t(lang, 'backup.delete.button.yes')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(deleteId('no', interaction.guild.id, interaction.user.id, target)).setLabel(t(lang, 'backup.delete.button.no')).setStyle(ButtonStyle.Secondary),
  ));
  await finish(interaction, card);
}

/** Step two: the person pressed Delete. */
async function runDelete(interaction, target) {
  const lang = await languageOf(interaction);
  const guildId = interaction.guild.id;
  let text;
  if (target === 'all') {
    const count = await deleteAllBackups(guildId);
    await recordBackupAudit(guildId, interaction.user.id, 'backups_deleted_all', null, { count });
    text = t(lang, 'backup.delete.doneAll', { emoji: EMOJI.APPROVE, count });
  } else {
    const number = Number(target);
    const removed = await deleteBackup(guildId, number);
    if (removed) await recordBackupAudit(guildId, interaction.user.id, 'backup_deleted', number, {});
    text = removed ? t(lang, 'backup.delete.doneOne', { emoji: EMOJI.APPROVE, number }) : t(lang, 'backup.notFound', { number });
  }
  await interaction.update({ components: [buildStatusCard(text, COLORS.GREEN, interaction, lang)], flags: BACKUP_MENU_FLAGS });
}

function buildDeleteModal(guildId, userId, lang = currentLanguage()) {
  return new ModalBuilder()
    .setCustomId(`backup_delete_modal:${guildId}:${userId}`)
    .setTitle(t(lang, 'backup.delete.modal.title'))
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target').setLabel(t(lang, 'backup.delete.modal.label')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder(t(lang, 'backup.restore.modal.example'))));
}

const RESTORE_PREFIX = 'backup_restore';
const restoreId = (action, guildId, userId, number, mode, extra = '') => [RESTORE_PREFIX, action, guildId, userId, number, mode, extra].filter((part, index) => index < 6 || part).join(':');
const PHASES = ['safety', 'roles', 'channels', 'settings', 'emojis', 'stickers', 'automod', 'cleanup'];
const barOf = (percent) => { const filled = Math.round(percent / 10); return '▰'.repeat(filled) + '▱'.repeat(10 - filled); };
const listNames = (names) => (names.length ? `${names.slice(0, 8).map((name) => `\`${String(name).slice(0, 40)}\``).join(', ')}${names.length > 8 ? ` +${names.length - 8}` : ''}` : '');

/** Step one of a restore: what it would do, with the buttons to go on or to give up. Nothing is changed here. */
async function restoreBackupForInteraction(interaction, { backupNumber, mode = 'merge' }) {
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
  if (jobs.isRunning(interaction.guild.id)) {
    await finish(interaction, buildStatusCard(t(lang, 'backup.restore.running', { emoji: EMOJI.WARNING }), COLORS.YELLOW, interaction, lang));
    return;
  }
  const backup = await getBackup(interaction.guild.id, backupNumber);
  if (!backup) {
    await finish(interaction, buildStatusCard(t(lang, 'backup.notFound', { number: backupNumber }), COLORS.RED, interaction, lang));
    return;
  }

  const number = publicBackupNumber(backup);
  await fetchSnapshotResources(interaction.guild);
  const plan = planRestore(interaction.guild, backup.snapshot, { mode, keepChannelIds: [interaction.channelId] });
  const replace = mode === 'replace';
  const lines = [
    t(lang, 'backup.restore.preview.title', { emoji: replace ? EMOJI.ALERT : EMOJI.WARNING, number, mode }),
    t(lang, 'backup.restore.preview.plan', { rolesCreate: plan.roles.create, rolesUpdate: plan.roles.update, channelsCreate: plan.channels.create, channelsUpdate: plan.channels.update, emojis: plan.emojis.create + plan.emojis.update }),
  ];
  if (replace) {
    lines.push(plan.deleteChannels.length || plan.deleteRoles.length
      ? t(lang, 'backup.restore.preview.delete', { emoji: EMOJI.ALERT, channels: plan.deleteChannels.length, roles: plan.deleteRoles.length })
      : t(lang, 'backup.restore.preview.deleteNone'));
    if (plan.deleteChannels.length) lines.push(t(lang, 'backup.restore.preview.deleteChannels', { names: listNames(plan.deleteChannels) }));
    if (plan.deleteRoles.length) lines.push(t(lang, 'backup.restore.preview.deleteRoles', { names: listNames(plan.deleteRoles) }));
  } else {
    lines.push(t(lang, 'backup.restore.preview.mergeNote'));
  }
  lines.push(t(lang, 'backup.restore.preview.safety'), t(lang, 'backup.restore.preview.next'));
  const card = textCard(lines.join('\n\n'), replace ? COLORS.RED : COLORS.YELLOW);
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(restoreId('go', interaction.guild.id, interaction.user.id, number, mode)).setLabel(t(lang, 'backup.restore.button.continue')).setStyle(replace ? ButtonStyle.Danger : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(restoreId('no', interaction.guild.id, interaction.user.id, number, mode)).setLabel(t(lang, 'backup.restore.button.cancel')).setStyle(ButtonStyle.Secondary),
  ));
  await finish(interaction, card);
}

/** Step two: the human check. A picture with letters (or the name of the server when the letters cannot be drawn) that must be answered. */
async function showRestoreChallenge(interaction, { guildId, userId, number, mode }) {
  const lang = await languageOf(interaction);
  const challenge = jobs.createRestoreChallenge(interaction.guild, interaction.user.id);
  const minutes = Math.round(challenge.seconds / 60);
  const card = new ContainerBuilder().setAccentColor(mode === 'replace' ? COLORS.RED : null)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(challenge.kind === 'letters'
      ? t(lang, 'backup.restore.captcha.letters', { emoji: EMOJI.WARNING, number, mode, minutes })
      : t(lang, 'backup.restore.captcha.name', { emoji: EMOJI.WARNING, number, mode, name: challenge.name })));
  const files = [];
  if (challenge.kind === 'letters') {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://restore.png')));
    files.push(new AttachmentBuilder(challenge.png, { name: 'restore.png' }));
  }
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(restoreId('type', guildId, userId, number, mode, challenge.id)).setLabel(t(lang, 'backup.restore.button.type')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(restoreId('go', guildId, userId, number, mode)).setLabel(t(lang, 'backup.restore.button.again')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(restoreId('no', guildId, userId, number, mode)).setLabel(t(lang, 'backup.restore.button.cancel')).setStyle(ButtonStyle.Secondary),
  ));
  await interaction.update({ components: [card], files, attachments: [], flags: BACKUP_MENU_FLAGS });
}

function buildRestoreModalCode(guildId, userId, number, mode, challengeId, lang = currentLanguage()) {
  return new ModalBuilder()
    .setCustomId(restoreId('code', guildId, userId, number, mode, challengeId).replace(`${RESTORE_PREFIX}:code`, 'backup_restore_code'))
    .setTitle(t(lang, 'backup.restore.captcha.modal.title'))
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel(t(lang, 'backup.restore.captcha.modal.label')).setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(100).setRequired(true)));
}

/** The card of a restore that is running (or that has ended): where it is, how far, and the button to stop it. */
function buildProgressCard(view, lang = currentLanguage()) {
  const lines = [];
  const finished = ['done', 'cancelled', 'failed'].includes(view.status);
  if (!finished) {
    lines.push(t(lang, 'backup.restore.progress.title', { emoji: EMOJI.LOADING, number: view.number, mode: view.mode }));
    lines.push(`${barOf(view.percent)} **${view.percent}%** · ${t(lang, 'backup.restore.progress.step', { done: view.done, total: view.total })}`);
    lines.push(t(lang, `backup.restore.progress.phase.${PHASES.includes(view.phase) ? view.phase : 'roles'}`));
    lines.push(view.status === 'cancelling' ? t(lang, 'backup.restore.progress.cancelling') : t(lang, 'backup.restore.progress.hint'));
  } else {
    const result = view.result;
    const created = (result?.roles?.created ?? 0) + (result?.channels?.created ?? 0);
    const failed = (result?.roles?.failed ?? 0) + (result?.channels?.failed ?? 0) + (result?.emojis?.failed ?? 0) + (result?.errorCount ?? 0);
    if (view.status === 'failed') lines.push(t(lang, 'backup.restore.failed', { emoji: EMOJI.DENY, error: view.error ?? '?', safety: view.safetyNumber ?? '?' }));
    else if (view.status === 'cancelled') lines.push(t(lang, 'backup.restore.stopped', { emoji: EMOJI.WARNING }));
    else lines.push(failed ? t(lang, 'backup.restore.warnings', { emoji: EMOJI.WARNING }) : t(lang, 'backup.restore.done', { emoji: EMOJI.APPROVE }));
    if (view.safetyNumber) lines.push(t(lang, 'backup.restore.summary', { number: view.number, mode: view.mode, safety: view.safetyNumber }));
    if (result) {
      lines.push(t(lang, view.mode === 'replace' ? 'backup.restore.detailsReplace' : 'backup.restore.details', {
        rolesCreated: result.roles?.created ?? 0, rolesUpdated: result.roles?.updated ?? 0,
        channelsCreated: result.channels?.created ?? 0, channelsUpdated: result.channels?.updated ?? 0,
        emojisCreated: result.emojis?.created ?? 0, emojisUpdated: result.emojis?.updated ?? 0,
        deletedChannels: result.deleted?.channels ?? 0, deletedRoles: result.deleted?.roles ?? 0,
      }));
      if ((result.stickers?.created ?? 0) + (result.automod?.created ?? 0) + (result.automod?.updated ?? 0) > 0) lines.push(t(lang, 'backup.restore.extras', { stickersCreated: result.stickers?.created ?? 0, automodCreated: result.automod?.created ?? 0, automodUpdated: result.automod?.updated ?? 0 }));
      if (result.deletionSkipped) lines.push(t(lang, 'backup.restore.deletionSkipped', { emoji: EMOJI.WARNING }));
      if (failed && result.errors?.length) lines.push(result.errors.map((error) => `• ${error}`).join('\n'));
    }
    void created;
  }
  const card = textCard(lines.join('\n\n'), finished ? (view.status === 'done' && !view.result?.errorCount ? COLORS.GREEN : COLORS.YELLOW) : COLORS.DEFAULT);
  if (!finished) {
    card.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${RESTORE_PREFIX}:stop:${view.guildId}`).setLabel(t(lang, 'backup.restore.button.stop')).setStyle(ButtonStyle.Danger).setDisabled(view.status === 'cancelling'),
    ));
  }
  return card;
}

/** Step three: the check was right. Makes the safety backup, restores while the same message shows the progress, and writes the end. */
async function startRestoreFromInteraction(interaction, { number, mode }) {
  const lang = await languageOf(interaction);
  const guild = interaction.guild;
  const backup = await getBackup(guild.id, number);
  if (!backup) {
    await interaction.update({ components: [buildStatusCard(t(lang, 'backup.notFound', { number }), COLORS.RED, interaction, lang)], files: [], attachments: [], flags: BACKUP_MENU_FLAGS });
    return;
  }
  await fetchSnapshotResources(guild);
  const reason = t(lang, 'backup.restore.reason', { number, user: interaction.user.tag ?? interaction.user.username });
  let expired = false;
  const edit = async (view) => {
    if (expired) return;
    try { await interaction.editReply({ components: [buildProgressCard(view, lang)], flags: BACKUP_MENU_FLAGS }); } catch { expired = true; }
  };
  let job;
  try {
    job = jobs.startRestoreJob(guild, {
      userId: interaction.user.id,
      number,
      mode,
      snapshot: backup.snapshot,
      reason,
      keepChannelIds: [interaction.channelId],
      prepare: async () => {
        const safety = await createBackup(guild.id, interaction.user.id, t(lang, 'backup.restore.safetyLabel', { number }), await buildFullSnapshot(guild), 'manual');
        await recordBackupAudit(guild.id, interaction.user.id, 'backup_created', publicBackupNumber(safety), { source: 'manual', purpose: 'restore_safety', beforeBackupNumber: number });
        return publicBackupNumber(safety);
      },
      finish: async (ended) => {
        clearInterval(timer);
        await recordBackupAudit(guild.id, interaction.user.id, 'backup_restored', number, { mode, safetyBackupNumber: ended.safetyNumber, status: ended.status, result: ended.result });
        const view = jobs.describeJob(ended);
        await edit(view);
        if (expired) await interaction.user.send({ components: [buildProgressCard(view, lang)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      },
    });
  } catch (error) {
    const text = error.code === 'restore_running' ? t(lang, 'backup.restore.running', { emoji: EMOJI.WARNING }) : t(lang, 'backup.restore.failed', { emoji: EMOJI.DENY, error: error.message, safety: '?' });
    await interaction.update({ components: [buildStatusCard(text, COLORS.YELLOW, interaction, lang)], files: [], attachments: [], flags: BACKUP_MENU_FLAGS });
    return;
  }
  await interaction.update({ components: [buildProgressCard(jobs.describeJob(job), lang)], files: [], attachments: [], flags: BACKUP_MENU_FLAGS });
  const timer = setInterval(() => { if (job.status === 'running') edit(jobs.describeJob(job)); }, 3_000);
  timer.unref?.();
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
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([t(lang, 'backup.panel.title', { emoji: EMOJI.STAR }), t(lang, 'backup.panel.intro', { server: guild.name })].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([t(lang, 'backup.panel.recent'), recent].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'backup.panel.scheduleHeading')}\n${scheduleText}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([t(lang, 'backup.panel.data'), '', t(lang, 'backup.panel.footer')].join('\n')))
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
        option('delete', 'delete'),
        option('schedule', 'schedule'),
        option('audit', 'audit'),
      ),
  );
}

function formatBackupList(rows, lang = currentLanguage()) {
  if (!rows.length) return t(lang, 'backup.list.empty', { emoji: EMOJI.STAR });
  return [t(lang, 'backup.list.title'), ...rows.map((row) => backupLine(row, lang)), '', t(lang, 'backup.list.footer')].join('\n');
}

const AUDIT_ACTIONS = ['backup_created', 'backups_listed', 'backup_exported', 'backup_restored', 'backup_deleted', 'backups_deleted_all', 'backups_pruned', 'backup_audit_viewed', 'schedule_updated', 'schedule_disabled'];

function formatAuditAction(action, lang = currentLanguage()) {
  return AUDIT_ACTIONS.includes(action) ? t(lang, `backup.audit.action.${action}`) : action;
}

function publicBackupNumber(row) {
  return row.backup_number ?? row.id;
}

function buildSnapshot(guild) {
  return {
    format: 'petto-server-backup',
    version: 3,
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
      rulesChannelId: guild.rulesChannelId ?? null,
      publicUpdatesChannelId: guild.publicUpdatesChannelId ?? null,
      safetyAlertsChannelId: guild.safetyAlertsChannelId ?? null,
      description: guild.description ?? null,
      preferredLocale: guild.preferredLocale ?? null,
      premiumProgressBarEnabled: guild.premiumProgressBarEnabled ?? null,
      systemChannelFlags: guild.systemChannelFlags?.bitfield ?? null,
    },
    roles: [...guild.roles.cache.values()]
      .filter((role) => !role.managed)
      .sort((a, b) => a.position - b.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, position: role.position, permissions: role.permissions.bitfield.toString(), unicodeEmoji: role.unicodeEmoji ?? null, iconURL: role.icon ? role.iconURL({ extension: 'png', size: 128 }) : null })),
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
        availableTags: Array.isArray(channel.availableTags) ? channel.availableTags.map((tag) => ({ name: tag.name, moderated: Boolean(tag.moderated), emojiId: tag.emoji?.id ?? null, emojiName: tag.emoji?.name ?? null })) : null,
        defaultReactionEmoji: channel.defaultReactionEmoji ? { id: channel.defaultReactionEmoji.id ?? null, name: channel.defaultReactionEmoji.name ?? null } : null,
        defaultSortOrder: 'defaultSortOrder' in channel ? channel.defaultSortOrder : null,
        defaultForumLayout: 'defaultForumLayout' in channel ? channel.defaultForumLayout : null,
        permissionOverwrites: channel.permissionOverwrites?.cache.map((overwrite) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() })) ?? [],
      })),
    emojis: [...guild.emojis.cache.values()].map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated, url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 256 }) })),
    stickers: [...(guild.stickers?.cache?.values() ?? [])].map((sticker) => ({ id: sticker.id, name: sticker.name, description: sticker.description ?? null, tags: sticker.tags ?? null, format: sticker.format, url: sticker.url })),
    automod: [],
  };
}

/**
 * The whole backup: what `buildSnapshot` reads from the cache plus what needs a request to Discord (the stickers and the AutoMod rules).
 * Nothing about the people of the server is kept: no member list, no messages. The only people in it are the ones named in the
 * permissions of a channel (their ID), which is what a restore needs to put those permissions back.
 */
async function buildFullSnapshot(guild) {
  await Promise.all([guild.stickers?.fetch?.().catch(() => null), guild.autoModerationRules?.fetch?.().catch(() => null)]);
  const snapshot = buildSnapshot(guild);
  snapshot.automod = [...(guild.autoModerationRules?.cache?.values() ?? [])].map((rule) => ({
    id: rule.id,
    name: rule.name,
    eventType: rule.eventType,
    triggerType: rule.triggerType,
    triggerMetadata: {
      keywordFilter: rule.triggerMetadata?.keywordFilter ?? [],
      regexPatterns: rule.triggerMetadata?.regexPatterns ?? [],
      presets: rule.triggerMetadata?.presets ?? [],
      allowList: rule.triggerMetadata?.allowList ?? [],
      mentionTotalLimit: rule.triggerMetadata?.mentionTotalLimit ?? null,
      mentionRaidProtectionEnabled: rule.triggerMetadata?.mentionRaidProtectionEnabled ?? false,
    },
    actions: (rule.actions ?? []).map((action) => ({ type: action.type, metadata: { channelId: action.metadata?.channelId ?? null, durationSeconds: action.metadata?.durationSeconds ?? null, customMessage: action.metadata?.customMessage ?? null } })),
    enabled: rule.enabled,
    exemptRoles: [...(rule.exemptRoles?.keys?.() ?? [])],
    exemptChannels: [...(rule.exemptChannels?.keys?.() ?? [])],
  }));
  return snapshot;
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
    );
}

/** Backups are paused: says so, and does nothing else. */
async function replyMaintenance(interaction) {
  const lang = await languageOf(interaction);
  await interaction.reply({ content: t(lang, 'backup.maintenance', { emoji: EMOJI.ALERT }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

module.exports.replyMaintenance = replyMaintenance;
module.exports.buildSnapshot = buildSnapshot;
module.exports.buildFullSnapshot = buildFullSnapshot;
module.exports.buildBackupMenuRow = buildBackupMenuRow;
module.exports.buildPanel = buildPanel;
module.exports.buildScheduleModal = buildScheduleModal;
module.exports.buildRestoreModal = buildRestoreModal;
module.exports.createBackupForInteraction = createBackupForInteraction;
module.exports.exportBackupForInteraction = exportBackupForInteraction;
module.exports.restoreBackupForInteraction = restoreBackupForInteraction;
module.exports.showRestoreChallenge = showRestoreChallenge;
module.exports.buildRestoreModalCode = buildRestoreModalCode;
module.exports.startRestoreFromInteraction = startRestoreFromInteraction;
module.exports.buildProgressCard = buildProgressCard;
module.exports.buildStatusCard = buildStatusCard;
module.exports.RESTORE_PREFIX = RESTORE_PREFIX;
module.exports.DELETE_PREFIX = DELETE_PREFIX;
module.exports.deleteBackupsForInteraction = deleteBackupsForInteraction;
module.exports.runDelete = runDelete;
module.exports.buildDeleteModal = buildDeleteModal;
module.exports.scheduleForInteraction = scheduleForInteraction;
module.exports.auditForInteraction = auditForInteraction;
module.exports.executeListFromMenu = list;
module.exports.BACKUP_MENU_PREFIX = BACKUP_MENU_PREFIX;
module.exports.LOADING_EMOJI = LOADING_EMOJI;
