// i18n-ignore-file: an event, it only counts.
// Counts the messages of the members of the servers that have message roles (utils/messageRoles.ts). Servers without rules cost one cached read. Written in TypeScript:
// compiled over messageCreateMessageRoles.js.
import { Events, type Client, type Message } from 'discord.js';
import { countMessage, flush, rulesOf } from '../utils/messageRoles';

const logger = require('../utils/logger') as { error: (message: string, error?: unknown) => void };

module.exports = {
  name: Events.MessageCreate,
  async execute(message: Message, client: Client): Promise<void> {
    if (!message.guild || message.author.bot || message.webhookId || message.system) return;
    try {
      const rules = await rulesOf(message.guild.id);
      if (!rules.some((rule) => rule.enabled)) return;
      if (countMessage(message.guild.id, message.author.id)) await flush(client ?? message.client);
    } catch (error) {
      logger.error(`Message roles count failed for message ${message.id}:`, error);
    }
  },
};
