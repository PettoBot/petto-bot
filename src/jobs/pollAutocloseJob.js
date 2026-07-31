const { MessageFlags } = require('discord.js');
const supabase = require('../db/supabase');
const pollsDb = require('../db/polls');
const { buildPollCard } = require('../utils/pollCard');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 60_000;

async function getDuePolls() {
  const { data, error } = await supabase.from('polls').select('*').eq('closed', false).not('ends_at', 'is', null).lte('ends_at', new Date().toISOString());
  if (error) throw error;
  return data;
}

async function processDuePolls(client) {
  const due = await getDuePolls();

  for (const poll of due) {
    try {
      await pollsDb.closePoll(poll.id);
      poll.closed = true;

      const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
      if (!channel) continue;
      const message = await channel.messages.fetch(poll.message_id).catch(() => null);
      if (!message) continue;

      const results = await pollsDb.getResults(poll.id, poll.options.length);
      const { components } = buildPollCard(poll, results);
      await message.edit({ components, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } catch (err) {
      logger.error(`Failed to auto-close poll #${poll.id}:`, err);
    }
  }
}

function startPollAutocloseJob(client) {
  setInterval(() => {
    processDuePolls(client).catch((err) => logger.error('Poll autoclose job error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Poll autoclose job started (checking every 60s).');
}

module.exports = { startPollAutocloseJob, processDuePolls };
