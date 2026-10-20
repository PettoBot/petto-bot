// A paginated message (`!pagination`) is deleted: its record goes too. Only a message id the server is known to paginate costs a
// database write (the list of those ids is kept for a minute per server).
const { Events } = require('discord.js');
const { messageIdsOf, deleteByMessages } = require('../db/paginations');
const logger = require('../utils/logger');

async function forget(guildId, messageIds) {
  if (!guildId || !messageIds.length) return;
  const known = await messageIdsOf(guildId);
  const gone = messageIds.filter((id) => known.has(String(id)));
  if (gone.length) await deleteByMessages(guildId, gone);
}

module.exports = {
  name: Events.MessageDelete,
  forget,
  async execute(message) {
    try {
      await forget(message.guildId ?? message.guild?.id, [message.id]);
    } catch (error) {
      logger.warn(`[pagination] could not forget a deleted message: ${error?.message ?? error}`);
    }
  },
};
