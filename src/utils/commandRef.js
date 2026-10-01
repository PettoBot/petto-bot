// How a command is written in a reply: `/embed edit` when it was run as a slash command, and with the prefix the
// person typed (the server's own, or the global one) when it was run from a message. An @mention prefix is not
// something to type again, so the server prefix is shown instead.
function commandRef(interaction, text, fallbackPrefix = '!') {
  if (!interaction?.rawMessage) return `/${text}`;
  const typed = String(interaction.typedPrefix ?? '').trim();
  const prefix = typed && !typed.startsWith('<@') ? typed : fallbackPrefix;
  return `${prefix}${text}`;
}

module.exports = { commandRef };
