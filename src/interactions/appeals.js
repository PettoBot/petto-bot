const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db/appeals');
const { PREFIX, resolveAppeal, staffReply } = require('../utils/appeals');
const logger = require('../utils/logger');

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

function canHandle(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild) || member?.permissions?.has(PermissionFlagsBits.BanMembers) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}

/** The buttons of the card of an appeal: `appeal::accept|reject|reply::<submission id>`. */
async function handleButton(interaction) {
  const [, action, submissionId] = interaction.customId.split('::');
  if (!interaction.guild) return;
  if (!canHandle(interaction.member)) { await interaction.reply(ephemeral('Only the staff who can manage the server or ban members can answer appeals.')); return; }
  if (!['accept', 'reject', 'reply'].includes(action)) return;
  const submission = await db.getSubmission(interaction.guild.id, submissionId).catch(() => null);
  if (!submission) { await interaction.reply(ephemeral('That appeal no longer exists.')); return; }
  if (action !== 'reply' && submission.status !== 'pending') { await interaction.reply(ephemeral('This appeal was already answered.')); return; }
  const input = new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Paragraph).setRequired(action === 'reply').setMaxLength(1000)
    .setLabel(action === 'reply' ? 'Message for the member' : 'Reason (optional, the member sees it)');
  const title = action === 'accept' ? 'Accept this appeal' : action === 'reject' ? 'Reject this appeal' : 'Reply to the member';
  await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}::m-${action}::${submissionId}`).setTitle(title).addComponents(new ActionRowBuilder().addComponents(input)));
}

async function handleModal(interaction) {
  const [, kind, submissionId] = interaction.customId.split('::');
  const action = String(kind).replace(/^m-/, '');
  if (!interaction.guild || !canHandle(interaction.member)) { await interaction.reply(ephemeral('You cannot answer appeals here.')); return; }
  const submission = await db.getSubmission(interaction.guild.id, submissionId).catch(() => null);
  if (!submission) { await interaction.reply(ephemeral('That appeal no longer exists.')); return; }
  const text = interaction.fields.getTextInputValue('text')?.trim() ?? '';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (action === 'reply') {
      const result = await staffReply({ client: interaction.client, guild: interaction.guild, submission, content: text, moderatorId: interaction.user.id, moderatorName: interaction.member?.displayName ?? interaction.user.username });
      await interaction.editReply(result.ok ? (result.dm ? 'Sent to the member.' : 'Saved, but the member has DMs closed. They can read it on the appeal site.') : 'Write something first.');
      return;
    }
    const result = await resolveAppeal({ client: interaction.client, guild: interaction.guild, submission, status: action === 'accept' ? 'accepted' : 'rejected', moderatorId: interaction.user.id, moderatorName: `<@${interaction.user.id}>`, reason: text });
    if (!result.ok) { await interaction.editReply(result.error === 'already_resolved' ? 'Someone answered this appeal first.' : 'That could not be done.'); return; }
    const notes = [action === 'accept' ? 'Appeal accepted.' : 'Appeal rejected.', result.lifted?.length ? `Lifted: ${result.lifted.join(', ')}.` : null, result.dm ? null : 'The member has DMs closed; they can see the answer on the appeal site.'].filter(Boolean);
    await interaction.editReply(notes.join(' '));
  } catch (err) {
    logger.error('Appeals interaction failed:', err);
    await interaction.editReply('Something went wrong. Try again.').catch(() => {});
  }
}

module.exports = { PREFIX, handleButton, handleModal };
