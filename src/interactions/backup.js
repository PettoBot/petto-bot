const { MessageFlags } = require('discord.js');
const backupCommand = require('../commands/config/backup');
const { EMOJI } = require('../utils/emojis');
const { t, languageOf } = require('../i18n');
const { backupsUnderMaintenance } = require('../utils/maintenance');
const { COLORS } = require('../utils/colors');
const jobs = require('../utils/backupJobs');

const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function parseContext(customId, prefix) {
  const parts = customId.split(':');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  return { guildId: parts[1], userId: parts[2] };
}

function ownsPanel(interaction, context) {
  return context
    && interaction.guildId === context.guildId
    && interaction.user.id === context.userId;
}

async function handleSelect(interaction) {
  if (backupsUnderMaintenance(interaction.user.id)) return backupCommand.replyMaintenance(interaction);
  const lang = await languageOf(interaction);
  const context = parseContext(interaction.customId, backupCommand.BACKUP_MENU_PREFIX);
  if (!ownsPanel(interaction, context)) {
    await interaction.reply({ content: t(lang, 'backup.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  const action = interaction.values[0];
  if (action === 'create') return backupCommand.createBackupForInteraction(interaction);
  if (action === 'list') return backupCommand.executeListFromMenu(interaction);
  if (action === 'export_latest') return backupCommand.exportBackupForInteraction(interaction);
  if (action === 'audit') return backupCommand.auditForInteraction(interaction);
  if (action === 'schedule') {
    await interaction.showModal(backupCommand.buildScheduleModal(context.guildId, context.userId, lang));
    return;
  }
  if (action === 'restore') {
    if (!interaction.member?.permissions?.has?.('Administrator')) {
      await interaction.reply({ content: t(lang, 'backup.restore.adminOnly', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.showModal(backupCommand.buildRestoreModal(context.guildId, context.userId, lang));
  }
}

async function handleScheduleModal(interaction) {
  if (backupsUnderMaintenance(interaction.user.id)) return backupCommand.replyMaintenance(interaction);
  const lang = await languageOf(interaction);
  const context = parseContext(interaction.customId, 'backup_schedule_modal');
  if (!ownsPanel(interaction, context)) {
    await interaction.reply({ content: t(lang, 'backup.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  const hours = Number(interaction.fields.getTextInputValue('hours'));
  const retention = Number(interaction.fields.getTextInputValue('retention'));
  if (!Number.isInteger(hours) || hours < 1 || hours > 168 || !Number.isInteger(retention) || retention < 1 || retention > 30) {
    await interaction.reply({ content: t(lang, 'backup.schedule.invalid', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  await backupCommand.scheduleForInteraction(interaction, { hours, retention });
}

async function handleRestoreModal(interaction) {
  if (backupsUnderMaintenance(interaction.user.id)) return backupCommand.replyMaintenance(interaction);
  const lang = await languageOf(interaction);
  const context = parseContext(interaction.customId, 'backup_restore_modal');
  if (!ownsPanel(interaction, context)) {
    await interaction.reply({ content: t(lang, 'backup.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  if (!interaction.member?.permissions?.has?.('Administrator')) {
    await interaction.reply({ content: t(lang, 'backup.restore.adminOnly', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  const backupNumber = Number(interaction.fields.getTextInputValue('backup_number'));
  const mode = interaction.fields.getTextInputValue('mode').trim().toLowerCase();
  if (!Number.isInteger(backupNumber) || backupNumber < 1 || !['merge', 'replace'].includes(mode)) {
    await interaction.reply({ content: t(lang, 'backup.restore.invalid', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  // Nothing is restored here: this shows what it would do and asks to confirm, step by step.
  await backupCommand.restoreBackupForInteraction(interaction, { backupNumber, mode });
}

/** `backup_restore:<step>:<guild>:<user>:<number>:<mode>[:<picture>]`, or `backup_restore:stop:<guild>`. */
function parseRestoreId(customId) {
  const [prefix, action, guildId, userId, number, mode, challengeId] = customId.split(':');
  if (prefix !== backupCommand.RESTORE_PREFIX || !/^\d{15,25}$/.test(guildId ?? '')) return null;
  return { action, guildId, userId, number: Number(number), mode, challengeId };
}

async function denyIfNotAllowed(interaction, lang, context, { owner = true } = {}) {
  if (backupsUnderMaintenance(interaction.user.id)) { await backupCommand.replyMaintenance(interaction); return true; }
  if (interaction.guildId !== context.guildId || (owner && interaction.user.id !== context.userId)) {
    await interaction.reply({ content: t(lang, 'backup.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  if (!interaction.member?.permissions?.has?.('Administrator')) {
    await interaction.reply({ content: t(lang, 'backup.restore.adminOnly', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

async function handleRestoreButton(interaction) {
  const lang = await languageOf(interaction);
  const context = parseRestoreId(interaction.customId);
  if (!context) return;
  if (context.action === 'stop') {
    if (await denyIfNotAllowed(interaction, lang, context, { owner: false })) return;
    const stopped = jobs.cancelJob(context.guildId);
    if (!stopped) {
      await interaction.reply({ content: t(lang, 'backup.restore.nothingRunning', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.update({ components: [backupCommand.buildProgressCard(jobs.describeJob(jobs.getJob(context.guildId)), lang)], flags: V2_EPHEMERAL });
    return;
  }
  if (!Number.isInteger(context.number) || !['merge', 'replace'].includes(context.mode)) return;
  if (await denyIfNotAllowed(interaction, lang, context)) return;
  if (context.action === 'no') {
    await interaction.update({ components: [backupCommand.buildStatusCard(t(lang, 'backup.restore.cancelled', { emoji: EMOJI.APPROVE }), COLORS.DEFAULT, interaction, lang)], files: [], attachments: [], flags: V2_EPHEMERAL });
    return;
  }
  if (jobs.isRunning(context.guildId)) {
    await interaction.reply({ content: t(lang, 'backup.restore.running', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (context.action === 'go') return backupCommand.showRestoreChallenge(interaction, context);
  if (context.action === 'type') {
    await interaction.showModal(backupCommand.buildRestoreModalCode(context.guildId, context.userId, context.number, context.mode, context.challengeId, lang));
  }
}

async function handleRestoreCodeModal(interaction) {
  const lang = await languageOf(interaction);
  const [, guildId, userId, number, mode, challengeId] = interaction.customId.split(':');
  const context = { guildId, userId, number: Number(number), mode, challengeId };
  if (!/^\d{15,25}$/.test(guildId ?? '') || !Number.isInteger(context.number) || !['merge', 'replace'].includes(mode)) return;
  if (await denyIfNotAllowed(interaction, lang, context)) return;
  const answer = interaction.fields.getTextInputValue('answer');
  const checked = jobs.checkRestoreChallenge(challengeId, guildId, interaction.user.id, answer);
  if (!checked.ok) {
    const key = checked.reason === 'locked' ? 'backup.restore.captcha.locked' : checked.reason === 'expired' ? 'backup.restore.captcha.expired' : 'backup.restore.captcha.wrong';
    if (checked.reason === 'locked') {
      await interaction.reply({ content: t(lang, key, { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.reply({ content: t(lang, key, { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  await backupCommand.startRestoreFromInteraction(interaction, { number: context.number, mode });
}

module.exports = { handleSelect, handleScheduleModal, handleRestoreModal, handleRestoreButton, handleRestoreCodeModal, V2_EPHEMERAL };
