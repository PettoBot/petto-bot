const db = require('../db/tickets');
const formsDb = require('../db/ticketForms');
const { openTicket } = require('../utils/ticketActions');
const { describeTicketOpenError } = require('../utils/ticketErrors');
const { usableFields, readAnswers } = require('../utils/ticketFormFields');
const { prepareFiles, answersMap, showName } = require('../utils/ticketAnswers');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');
const { safeTicketAction } = require('../utils/safeTicketAction');

/**
 * The form of a ticket was sent: the answers are read (text, choices, marks, members, roles, channels and files), checked (what is required;
 * only pictures where the question asks for pictures) and the ticket opens with them. Every refusal is told to the member alone.
 * Copying the files takes longer than the three seconds Discord gives, so the answer is announced first, before anything is read.
 * `deps.download` replaces the download of the files (the checks do).
 */
async function handleModal(interaction, deps = {}) {
  const [, categoryId, formId] = interaction.customId.split('::');
  return safeTicketAction(interaction, 'tk_form', async (ctx) => {
    const lang = await languageOf(interaction);
    const category = await db.getCategoryById(categoryId);
    const form = await formsDb.getFormById(formId);
    const fields = form ? usableFields(form.fields) : [];
    if (!category || !form || String(category.form_id) !== String(form.id) || !fields.length) {
      await ctx.say(t(lang, 'tickets.form.unavailable'));
      return;
    }

    const { entries, missing } = readAnswers(fields, interaction.fields.fields);
    if (missing.length) {
      await ctx.say(t(lang, 'tickets.form.completeField', { field: missing[0] }));
      return;
    }
    const { refused } = await prepareFiles(entries, { guild: interaction.guild, download: deps.download });
    if (refused) {
      await ctx.say(t(lang, 'tickets.form.notImage', { emoji: EMOJI.DENY, field: refused.label, file: showName(refused.name) }));
      return;
    }

    try {
      const { channel } = await openTicket({ guild: interaction.guild, client: interaction.client, category, opener: interaction.user, formAnswers: answersMap(entries), formEntries: entries });
      await ctx.say(t(lang, 'tickets.open.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }));
    } catch (err) {
      // What the member needs to hear (a full category, a missing permission); only an unexpected failure is for the team, through the triage.
      await ctx.say(describeTicketOpenError(err, lang));
      if (!err.userFacing) logger.error({ guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user?.id, command: 'tk_form', source: 'ticket' }, 'Ticket form submit failed:', err);
    }
  }, {
    ack: 'reply',
    // Sending the form twice must not open two tickets.
    lockKey: `tk_form:${interaction.guildId}:${interaction.user?.id}:${categoryId}`,
    goneIsDone: false,
    // A second try could open a second channel if the first one was made but the answer was lost.
    retry: false,
    label: 'Ticket form submit failed:', // i18n-ignore: log text for the team
  }, deps.safe);
}

module.exports = { handleModal };
