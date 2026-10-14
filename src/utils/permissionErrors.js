// Errors that only say the bot is missing a permission in a channel. They are the server's to fix, not a bug, so they are told to the
// member in plain words and kept out of the channel of errors.
const CODES = new Map([
  [50013, 'Missing Permissions'],
  [50001, 'Missing Access'],
  [160002, 'Read Message History'],
  [50007, 'Cannot send messages to this user'],
  [40333, 'Cannot send messages in this channel'],
]);

const isPermissionError = (error) => Boolean(error) && CODES.has(error.code);

/** What to tell the member when a command could not run because of a permission. */
function permissionHelp(error) {
  if (error?.code === 160002) return 'I am missing the **Read Message History** permission in this channel, so I could not answer. Ask the staff to give it to me.';
  if (error?.code === 50001) return 'I cannot see that channel. Ask the staff to give me **View Channel** there.';
  return 'I am missing a permission here (for example **Send Messages**, **Embed Links** or **Attach Files**). Ask the staff to check my permissions in this channel.';
}

module.exports = { isPermissionError, permissionHelp };
