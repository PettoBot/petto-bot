// Answering a message by quoting it needs Read Message History in the channel (and the message to still be there). Without it Discord
// refuses with "Cannot reply without permission to read message history" (160002) and the command looks dead. This makes `message.reply`
// fall back to a normal message in the channel in those cases, for every command, responder and event at once.
const { PermissionFlagsBits } = require('discord.js');

// 160002: no Read Message History. 10008: the message is gone. 50035 with a message_reference problem: the quoted message cannot be used.
const REFERENCE_CODES = new Set([160002, 10008]);

function isReferenceProblem(error) {
  if (!error) return false;
  if (REFERENCE_CODES.has(error.code)) return true;
  return error.code === 50035 && Boolean(error.rawError?.errors?.message_reference);
}

/** The options of a reply as the ones of a plain message (a text becomes `{ content }`, the quote is left out). */
function withoutQuote(options) {
  const base = typeof options === 'string' ? { content: options } : { ...(options ?? {}) };
  delete base.reply;
  delete base.failIfNotExists;
  return base;
}

/** True when the bot is known to lack Read Message History where the message is. */
function cannotQuote(message) {
  const me = message.guild?.members?.me;
  const channel = message.channel;
  if (!me || typeof channel?.permissionsFor !== 'function') return false;
  const permissions = channel.permissionsFor(me);
  return Boolean(permissions) && !permissions.has(PermissionFlagsBits.ReadMessageHistory);
}

/** Replaces `reply` of Message with the safe one. `Message` is a parameter so a test can use its own. */
function installSafeReply(Message) {
  if (!Message?.prototype || Message.prototype.reply.__petto) return;
  const original = Message.prototype.reply;
  async function reply(options) {
    if (cannotQuote(this)) return this.channel.send(withoutQuote(options));
    try {
      return await original.call(this, options);
    } catch (error) {
      if (!isReferenceProblem(error)) throw error;
      return this.channel.send(withoutQuote(options));
    }
  }
  reply.__petto = true;
  Message.prototype.reply = reply;
}

module.exports = { installSafeReply, isReferenceProblem, withoutQuote, cannotQuote };
