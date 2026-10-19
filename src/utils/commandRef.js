// How a command is written in a reply: `/embed edit` when it was run as a slash command, and with the prefix the
// person typed (the server's own, or the global one) when it was run from a message. An @mention prefix is not
// something to type again, so the server prefix is shown instead.
// A slash run names another command with `/` only when that command is a slash command too; otherwise with the prefix.
function commandRef(interaction, text, fallbackPrefix = '!') {
  if (!interaction?.rawMessage) {
    const name = String(text).trim().split(/\s+/)[0];
    const command = interaction?.client?.commands?.get?.(name);
    // Without the list of commands (a check, an old caller) it stays as before.
    if (!command || require('../handlers/commandHandler').isSlashCommand(command)) return `/${text}`;
    return `${fallbackPrefix || '!'}${text}`;
  }
  const typed = String(interaction.typedPrefix ?? '').trim();
  const prefix = typed && !typed.startsWith('<@') ? typed : (fallbackPrefix || '!');
  return `${prefix}${text}`;
}

module.exports = { commandRef };
