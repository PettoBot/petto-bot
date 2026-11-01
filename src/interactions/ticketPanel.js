const db = require('../db/tickets');
const { openTicketInteractive } = require('../utils/ticketActions');
const { safeTicketAction } = require('../utils/safeTicketAction');
const { t, languageOf } = require('../i18n');

/**
 * The panel button or menu: the category is looked up, and a category with a form opens a window (which must be the very first answer), any other
 * one opens the ticket. When the lookup is slower than Discord waits, the press is acknowledged first and the ticket still opens (a form then
 * asks to press again once).
 */
async function openFromKey(interaction, categoryKey, name, deps = {}) {
  return safeTicketAction(interaction, name, async (ctx) => {
    const lang = await languageOf(interaction);
    const { value: category, late } = await ctx.afterDeadline(db.getCategoryByKey(interaction.guild.id, categoryKey), 'reply');
    if (!category) {
      await ctx.say(t(lang, 'tickets.categoryGone'));
      return;
    }
    if (late && category.form_id) {
      await ctx.say(t(lang, 'tickets.safe.tryAgain'));
      return;
    }
    await openTicketInteractive(interaction, category, lang);
  }, {
    ack: 'none',
    // Pressing the panel twice must not open two tickets at once.
    lockKey: `${name}:${interaction.guildId}:${interaction.user?.id}:${categoryKey}`,
    // The category or the channel it points to is gone: that is a real answer for the member, not "already done".
    goneIsDone: false,
    retry: false,
    label: 'Ticket panel press failed:', // i18n-ignore: log text for the team
    expiredKey: 'tickets.safe.tryAgain',
  }, deps.safe);
}

/** Panel button click — customId `tk_open::<categoryKey>`. */
async function handleButton(interaction, deps = {}) {
  const [, categoryKey] = interaction.customId.split('::');
  return openFromKey(interaction, categoryKey, 'tk_open', deps);
}

/** Panel dropdown selection — customId `tk_open_select`, value is the chosen category key. */
async function handleSelect(interaction, deps = {}) {
  return openFromKey(interaction, interaction.values[0], 'tk_open_select', deps);
}

module.exports = { handleButton, handleSelect };
