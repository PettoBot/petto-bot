// A claimed request that is not finished in the time the server chose goes back to open, so another staff member can take it
// (Premium). The card is updated and the staff is told in the same channel.
const { MessageFlags } = require('discord.js');
const requestsDb = require('../db/requests');
const { getGuildPremium } = require('../db/premium');
const { requestCard } = require('./requestCards');
const logger = require('./logger');

async function unclaimLate(client) {
  const configs = await requestsDb.listConfigsWithTimeout();
  let count = 0;
  for (const config of configs) {
    const premium = await getGuildPremium(config.guild_id).catch(() => ({ active: false }));
    if (!premium?.active) continue;
    const late = await requestsDb.listClaimedBefore(config.guild_id, new Date(Date.now() - config.completion_hours * 3_600_000));
    for (const request of late) {
      const claimer = request.claimed_by;
      const updated = await requestsDb.update(config.guild_id, request.number, { status: 'open', claimed_by: null, claimed_at: null });
      if (!updated) continue;
      count += 1;
      try {
        const channel = updated.channel_id ? await client.channels.fetch(updated.channel_id).catch(() => null) : null;
        const message = channel && updated.message_id ? await channel.messages.fetch(updated.message_id).catch(() => null) : null;
        if (message) await message.edit({ components: [requestCard(updated)], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
        if (channel) await channel.send({ content: `Request #${updated.number} was claimed by <@${claimer}> and not finished in ${config.completion_hours} hours, so it is open again.`, allowedMentions: { users: [claimer] } }).catch(() => null);
      } catch (error) {
        logger.warn(`Request timeout notice failed in guild ${config.guild_id}: ${error.message}`);
      }
    }
  }
  return count;
}

module.exports = { unclaimLate };
