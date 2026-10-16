const { MessageFlags } = require('discord.js');
const backupCommand = require('../commands/config/backup');
const { EMOJI } = require('../utils/emojis');
const { t, languageOf } = require('../i18n');
const { backupsUnderMaintenance } = require('../utils/maintenance');

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
  if (backupsUnderMaintenance()) return backupCommand.replyMaintenance(interaction);
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
  if (backupsUnderMaintenance()) return backupCommand.replyMaintenance(interaction);
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
  if (backupsUnderMaintenance()) return backupCommand.replyMaintenance(interaction);
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
  const confirm = interaction.fields.getTextInputValue('confirm').trim().toUpperCase();
  if (!Number.isInteger(backupNumber) || backupNumber < 1 || !['merge', 'replace'].includes(mode)) {
    await interaction.reply({ content: t(lang, 'backup.restore.invalid', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (confirm !== 'CONFIRM') {
    await interaction.reply({ content: t(lang, 'backup.restore.typeConfirm', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  await backupCommand.restoreBackupForInteraction(interaction, { backupNumber, mode, confirmed: true });
}

module.exports = { handleSelect, handleScheduleModal, handleRestoreModal, V2_EPHEMERAL };
