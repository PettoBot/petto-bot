const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db/appeals');
const { PREFIX, resolveAppeal, staffReply, liftedText } = require('../utils/appeals');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

function canHandle(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild) || member?.permissions?.has(PermissionFlagsBits.BanMembers) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}

/** The buttons of the card of an appeal: `appeal::accept|reject|reply::<submission id>`. */
async function handleButton(interaction) {
  const [, action, submissionId] = interaction.customId.split('::');
  if (!interaction.guild) return;
  const lang = await languageOf(interaction);
  if (!canHandle(interaction.member)) { await interaction.reply(ephemeral(t(lang, 'appeals.staff.notAllowed'))); return; }
  if (!['accept', 'reject', 'reply'].includes(action)) return;
  const submission = await db.getSubmission(interaction.guild.id, submissionId).catch(() => null);
  if (!submission) { await interaction.reply(ephemeral(t(lang, 'appeals.staff.gone'))); return; }
  if (action !== 'reply' && submission.status !== 'pending') { await interaction.reply(ephemeral(t(lang, 'appeals.staff.alreadyAnswered'))); return; }
  const input = new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Paragraph).setRequired(action === 'reply').setMaxLength(1000)
    .setLabel(t(lang, action === 'reply' ? 'appeals.form.messageLabel' : 'appeals.form.reasonLabel'));
  const title = t(lang, `appeals.form.${action}Title`);
  await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}::m-${action}::${submissionId}`).setTitle(title).addComponents(new ActionRowBuilder().addComponents(input)));
}

async function handleModal(interaction) {
  const [, kind, submissionId] = interaction.customId.split('::');
  const action = String(kind).replace(/^m-/, '');
  const lang = await languageOf(interaction);
  if (!interaction.guild || !canHandle(interaction.member)) { await interaction.reply(ephemeral(t(lang, 'appeals.staff.cannotHere'))); return; }
  const submission = await db.getSubmission(interaction.guild.id, submissionId).catch(() => null);
  if (!submission) { await interaction.reply(ephemeral(t(lang, 'appeals.staff.gone'))); return; }
  const text = interaction.fields.getTextInputValue('text')?.trim() ?? '';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (action === 'reply') {
      const result = await staffReply({ client: interaction.client, guild: interaction.guild, submission, content: text, moderatorId: interaction.user.id, moderatorName: interaction.member?.displayName ?? interaction.user.username });
      await interaction.editReply(t(lang, result.ok ? (result.dm ? 'appeals.staff.replySent' : 'appeals.staff.replySavedNoDm') : 'appeals.staff.replyEmpty'));
      return;
    }
    const result = await resolveAppeal({ client: interaction.client, guild: interaction.guild, submission, status: action === 'accept' ? 'accepted' : 'rejected', moderatorId: interaction.user.id, moderatorName: `<@${interaction.user.id}>`, reason: text });
    if (!result.ok) { await interaction.editReply(t(lang, result.error === 'already_resolved' ? 'appeals.staff.answeredFirst' : 'appeals.staff.failed')); return; }
    const notes = [
      t(lang, action === 'accept' ? 'appeals.staff.accepted' : 'appeals.staff.rejected'),
      result.lifted?.length ? t(lang, 'appeals.staff.lifted', { lifted: liftedText(result.lifted, lang) }) : null,
      result.dm ? null : t(lang, 'appeals.staff.noDm'),
    ].filter(Boolean);
    await interaction.editReply(notes.join(' '));
  } catch (err) {
    logger.error('Appeals interaction failed:', err);
    await interaction.editReply(t(lang, 'appeals.staff.error')).catch(() => {});
  }
}

module.exports = { PREFIX, handleButton, handleModal };
