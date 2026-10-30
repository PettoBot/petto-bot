// i18n-ignore-file: wiring of the library, not text for people.
// Puts silent mentions (utils/silentMentions.js) at the one place where every message the bot sends meets: the library builds the body of
// each send in `MessagePayload.resolveBody`, whether it comes from `channel.send`, `message.reply`, `message.edit`, `interaction.reply`,
// `interaction.editReply`, `followUp`, `update`, a webhook (`sendAs`) or a direct message. The text is final there (variables are expanded
// long before), so the last step before sending is the right moment. A payload with no `!` mention goes through untouched.
const logger = require('./logger');
const { applySilentMentions } = require('./silentMentions');

const MARK = Symbol.for('petto.silentMentions');

/** The server a send goes to, when the target says it (a channel, a message, an interaction, a webhook, a reply webhook of an interaction). */
function guildOf(target) {
  try {
    const guild = target?.guild ?? target?.channel?.guild;
    if (guild) return guild;
    const id = target?.guildId ?? target?.channel?.guildId ?? target?.[MARK];
    return id ? target?.client?.guilds?.cache?.get(id) ?? null : null;
  } catch {
    return null;
  }
}

/** Hooks `MessagePayload.resolveBody` (once). `MessagePayload` is the class of discord.js; a test can give a copy. */
function installSilentMentions(client, MessagePayload = require('discord.js').MessagePayload) {
  const proto = MessagePayload.prototype;
  if (!proto.resolveBody[MARK]) {
    const original = proto.resolveBody;
    const hooked = function resolveBodyWithSilentMentions() {
      if (!this.body) {
        try {
          const next = applySilentMentions(this.options, guildOf(this.target), { defaults: this.target?.client?.options?.allowedMentions });
          if (next !== this.options) this.options = next;
        } catch (error) {
          // A message is never lost because of this step: it goes as it was written.
          logger.warn({ action: 'silent-mentions' }, `Silent mentions could not be applied: ${error.message}`);
        }
      }
      return original.call(this);
    };
    hooked[MARK] = true;
    proto.resolveBody = hooked;
  }
  // The webhook an interaction answers through (editReply, followUp) does not know its server: it is told when the interaction arrives.
  if (client?.prependListener) {
    client.prependListener('interactionCreate', (interaction) => {
      if (interaction?.webhook && interaction.guildId) interaction.webhook[MARK] = interaction.guildId;
    });
  }
}

module.exports = { installSilentMentions, guildOf };
