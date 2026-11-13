// i18n-ignore-file: the buttons and the form under the cards of the Petto team (operators only), in English. What the reporter reads comes from the catalog (dm.team.*).
// The card of a DM report in the team channel: "Reply to reporter", "Mark handled" and "Block reporter". Only the Petto team may press them (the same people as the other team tools).
// A handled report is final: there is no button or statement that opens it again (and a handled report is not answered either), and an old button pressed twice only says so.
// "Block reporter" asks why (only the team sees it) and stops that person from sending more DM reports: they are told they cannot, not why. `!blacklist reporter ...` is the same list.
const { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { isPettoOperator } = require('../utils/autoModControl');
const { teamCard } = require('../utils/dmReports');
const { TEAM_PREFIX, sendDm } = require('../utils/dmOrigin');
const { plainCard } = require('../utils/plainCard');
const { cleanReason, refusalFor } = require('../utils/reportBlocks');
const { DEFAULT_REASON, LIMITS: BLOCK_LIMITS } = require('../db/dmReportBlocks');
const { opsNote, oneLine } = require('../utils/teamTools');
const { t } = require('../i18n');
const logger = require('../utils/logger');

const REPLY = Object.freeze({ min: 10, max: 1500, field: 'reply', modal: `${TEAM_PREFIX}:replym` });
const BLOCK = Object.freeze({ field: 'reason', modal: `${TEAM_PREFIX}:blockm` });
const LANGUAGES = new Set(['en', 'es', 'pt-BR']);

const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const FINAL = 'This report was already handled (it is final and cannot be reopened), or it does not exist.';

/** The form that asks what to tell the reporter. */
function replyModal(row) {
  return new ModalBuilder()
    .setCustomId(`${REPLY.modal}:${row.id}`)
    .setTitle(`Reply to report #${row.id}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Message for the reporter')
        .setDescription('They get it in their DMs with Petto, as a message of the Petto team. Your name is not shown.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(REPLY.field)
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('What happened with the report and what they have to do')
            .setMinLength(REPLY.min)
            .setMaxLength(REPLY.max)
            .setRequired(true),
        ),
    );
}

/** What the reporter gets: the team's words quoted, in the language they reported in, with no mention that can notify anyone. */
function replyPayload(row, text, lang) {
  const quoted = String(text).trim().replace(/\r\n/g, '\n').split('\n').map((line) => `> ${line}`).join('\n');
  return { ...plainCard(`### ${t(lang, 'dm.team.title', { number: row.id })}\n${quoted}\n\n-# ${t(lang, 'dm.team.footer')}`), allowedMentions: { parse: [] } };
}

/** The form that asks why the reporter is blocked: only the team reads it (the person is told they cannot send reports, not why). */
function blockModal(row) {
  return new ModalBuilder()
    .setCustomId(`${BLOCK.modal}:${row.id}`)
    .setTitle('Block this reporter'.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Why are you blocking them?')
        .setDescription('Only the team sees it. They are told they cannot send reports, not why.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(BLOCK.field)
            .setStyle(TextInputStyle.Short)
            .setValue(DEFAULT_REASON)
            .setMinLength(BLOCK_LIMITS.reasonMin)
            .setMaxLength(BLOCK_LIMITS.reasonMax)
            .setRequired(true),
        ),
    );
}

/** `dmteam:done:<id>`, `dmteam:reply:<id>` and `dmteam:block:<id>`. (`dmteam:open:<id>` from a card of an older version is not valid any more: nothing reopens a report.) */
async function handleTeamButton(interaction, deps = {}) {
  const db = deps.db ?? require('../db/dmReports');
  const match = new RegExp(`^${TEAM_PREFIX}:(done|reply|block):(\\d{1,18})$`).exec(interaction.customId);
  if (!match) return reply(interaction, 'That button is not valid any more.');
  if (!isPettoOperator(interaction.user.id)) return reply(interaction, 'Only the Petto team can do this.');

  if (match[1] === 'block') {
    const row = await db.get(match[2]);
    if (!row) return reply(interaction, 'That report does not exist.');
    if (row.reporter_blocked) return reply(interaction, 'That person is already blocked from sending reports.');
    return interaction.showModal(blockModal(row));
  }

  if (match[1] === 'reply') {
    const row = await db.get(match[2]);
    if (!row || row.status !== 'open') return reply(interaction, FINAL);
    return interaction.showModal(replyModal(row));
  }

  const row = await db.handle(match[2], interaction.user.id);
  if (!row) return reply(interaction, FINAL);
  return interaction.update(teamCard(row, { handledBy: row.handled_by ?? interaction.user.id }));
}

/** `dmteam:blockm:<id>`: the form of the block was sent. The person cannot send DM reports any more, the team's operations channel has a note, and the card says so. */
async function handleBlockModal(interaction, deps = {}) {
  const db = deps.db ?? require('../db/dmReports');
  const blocks = deps.blocks ?? require('../db/dmReportBlocks');
  const match = new RegExp(`^${BLOCK.modal}:(\\d{1,18})$`).exec(interaction.customId);
  if (!match) return reply(interaction, 'That form is not valid any more.');
  if (!isPettoOperator(interaction.user.id)) return reply(interaction, 'Only the Petto team can do this.');

  const checked = cleanReason(interaction.fields.getTextInputValue(BLOCK.field));
  if (!checked.ok) return reply(interaction, checked.error);
  const row = await db.get(match[1]);
  if (!row) return reply(interaction, 'That report does not exist.');
  const user = await interaction.client.users.fetch(row.reporter_id).catch(() => null);
  const refusal = refusalFor(String(row.reporter_id), user, interaction.client.user?.id);
  if (refusal) return reply(interaction, refusal);

  const added = await blocks.add({ userId: row.reporter_id, userTag: row.reporter_tag ?? user?.username ?? null, reason: checked.reason, by: interaction.user.id, reportId: row.id });
  if (!added) return reply(interaction, 'That person was already blocked from sending reports.');
  await opsNote(interaction.client, `**Reporter blocked** (from the card of DM report #${row.id}).\nPerson: \`${row.reporter_id}\` (\`${oneLine(row.reporter_tag, 40) || 'unknown'}\`)\nReason: ${oneLine(checked.reason, 300)}\nBy: <@${interaction.user.id}> (\`${interaction.user.id}\`)`).catch(() => null);
  if (typeof interaction.update === 'function') return interaction.update(teamCard({ ...row, reporter_blocked: true }));
  return reply(interaction, 'Blocked. They cannot send DM reports any more.');
}

/** `dmteam:replym:<id>`: the form was sent. The reporter gets the message by DM and the card says it was answered. (`dmteam:blockm:<id>` is the form of the block.) */
async function handleTeamModal(interaction, deps = {}) {
  if (String(interaction.customId).startsWith(`${BLOCK.modal}:`)) return handleBlockModal(interaction, deps);
  const db = deps.db ?? require('../db/dmReports');
  const send = deps.sendDm ?? sendDm;
  const match = new RegExp(`^${REPLY.modal}:(\\d{1,18})$`).exec(interaction.customId);
  if (!match) return reply(interaction, 'That form is not valid any more.');
  if (!isPettoOperator(interaction.user.id)) return reply(interaction, 'Only the Petto team can do this.');

  const text = String(interaction.fields.getTextInputValue(REPLY.field) ?? '').trim();
  if (text.length < REPLY.min) return reply(interaction, `Write at least ${REPLY.min} characters.`);
  const row = await db.get(match[1]);
  if (!row || row.status !== 'open') return reply(interaction, FINAL);

  const user = await interaction.client.users.fetch(row.reporter_id).catch(() => null);
  const lang = LANGUAGES.has(row.reporter_lang) ? row.reporter_lang : 'en';
  const sent = user ? await send(user, replyPayload(row, text, lang), { guild: null, kind: 'team' }).then(() => true, (error) => { logger.localWarn?.(`Could not answer DM report #${row.id}: ${error.message}`); return false; }) : false;
  if (!sent) return reply(interaction, 'I could not message the reporter: they closed their DMs or blocked Petto. Nothing was sent.');

  const updated = await db.replied(row.id, interaction.user.id).catch(() => null);
  if (updated && typeof interaction.update === 'function') return interaction.update(teamCard(updated));
  return reply(interaction, 'Sent to the reporter.');
}

module.exports = { handleTeamButton, handleTeamModal, handleBlockModal, replyModal, blockModal, replyPayload, REPLY, BLOCK };
