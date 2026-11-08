// i18n-ignore-file: the buttons and the form under the cards of the Petto team (operators only), in English. What the reporter reads comes from the catalog (dm.team.*).
// The card of a DM report in the team channel: "Reply to reporter" and "Mark handled". Only the Petto team may press them (the same people as the other team tools).
// A handled report is final: there is no button or statement that opens it again (and a handled report is not answered either), and an old button pressed twice only says so.
const { CheckboxBuilder, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { isPettoOperator } = require('../utils/autoModControl');
const { teamCard } = require('../utils/dmReports');
const { TEAM_PREFIX, sendDm } = require('../utils/dmOrigin');
const { plainCard } = require('../utils/plainCard');
const { t } = require('../i18n');
const logger = require('../utils/logger');

const REPLY = Object.freeze({ min: 10, max: 1500, field: 'reply', handle: 'handle', modal: `${TEAM_PREFIX}:replym` });
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
      // Answering and closing in one step: the report is marked handled once the message is on its way.
      new LabelBuilder()
        .setLabel('Mark the report as handled after sending')
        .setCheckboxComponent(new CheckboxBuilder().setCustomId(REPLY.handle)),
    );
}

const readCheckbox = (fields, id) => { try { return fields.getCheckbox(id) === true; } catch { return false; } };

/** What the reporter gets: the team's words quoted, in the language they reported in, with no mention that can notify anyone. */
function replyPayload(row, text, lang) {
  const quoted = String(text).trim().replace(/\r\n/g, '\n').split('\n').map((line) => `> ${line}`).join('\n');
  return { ...plainCard(`### ${t(lang, 'dm.team.title', { number: row.id })}\n${quoted}\n\n-# ${t(lang, 'dm.team.footer')}`), allowedMentions: { parse: [] } };
}

/** `dmteam:done:<id>` and `dmteam:reply:<id>`. (`dmteam:open:<id>` from a card of an older version is not valid any more: nothing reopens a report.) */
async function handleTeamButton(interaction, deps = {}) {
  const db = deps.db ?? require('../db/dmReports');
  const match = new RegExp(`^${TEAM_PREFIX}:(done|reply):(\\d{1,18})$`).exec(interaction.customId);
  if (!match) return reply(interaction, 'That button is not valid any more.');
  if (!isPettoOperator(interaction.user.id)) return reply(interaction, 'Only the Petto team can do this.');

  if (match[1] === 'reply') {
    const row = await db.get(match[2]);
    if (!row || row.status !== 'open') return reply(interaction, FINAL);
    return interaction.showModal(replyModal(row));
  }

  const row = await db.handle(match[2], interaction.user.id);
  if (!row) return reply(interaction, FINAL);
  return interaction.update(teamCard(row, { handledBy: row.handled_by ?? interaction.user.id }));
}

/** `dmteam:replym:<id>`: the form was sent. The reporter gets the message by DM and the card says it was answered. */
async function handleTeamModal(interaction, deps = {}) {
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

  let updated = await db.replied(row.id, interaction.user.id).catch(() => null);
  // "Mark handled" ticked: the report is closed with the answer (final, like the button: it has no way back).
  if (readCheckbox(interaction.fields, REPLY.handle)) {
    const closed = await db.handle(row.id, interaction.user.id).catch(() => null);
    if (closed) updated = { ...(updated ?? row), ...closed };
  }
  if (updated && typeof interaction.update === 'function') return interaction.update(teamCard(updated, { handledBy: updated.status === 'handled' ? (updated.handled_by ?? interaction.user.id) : null }));
  return reply(interaction, 'Sent to the reporter.');
}

module.exports = { handleTeamButton, handleTeamModal, replyModal, replyPayload, REPLY };
