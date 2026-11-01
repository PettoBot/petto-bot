// i18n-ignore-file: what the team reads in the logs.
// What the top level of the interaction handler does with an error that came out of a command, a button, a menu or a form. An expected one (the
// interaction expired after its 3 seconds, a channel or message that was already deleted, a rate limit, a network hiccup) is a warning for the
// general log; anything else is an error, which reaches the priority log (see errorTriage.js). Both carry the server, channel, user and what was pressed.
const logger = require('./logger');
const { classify, isErrorLike } = require('./errorTriage');

/** Where it happened, as the logger wants it. */
function interactionContext(interaction, label = null) {
  const id = String(interaction?.customId ?? '');
  return {
    guildId: interaction?.guildId ?? interaction?.guild?.id ?? undefined,
    channelId: interaction?.channelId ?? interaction?.channel?.id ?? undefined,
    userId: interaction?.user?.id ?? undefined,
    command: interaction?.commandName ? `/${interaction.commandName}` : (id.split(/::|:/)[0] || label || undefined),
    action: id || undefined,
    source: 'interactionCreate',
  };
}

/** Logs an error of an interaction: a warning when it is expected, an error when it needs a look. Returns the triage. */
function reportInteractionError(interaction, label, error) {
  const triage = classify(isErrorLike(error) ? error : null, { args: [label, error] });
  const context = interactionContext(interaction, label);
  if (triage.benign) {
    logger.warn(context, `${label} ${error?.message ?? error} (expected: ${triage.kind})`, ...(isErrorLike(error) ? [error] : []));
  } else {
    logger.error(context, label, error);
  }
  return triage;
}

module.exports = { reportInteractionError, interactionContext };
