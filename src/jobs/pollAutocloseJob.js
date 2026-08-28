const { MessageFlags } = require('discord.js');
const supabase = require('../db/supabase');
const pollsDb = require('../db/polls');
const { buildPollCard } = require('../utils/pollCard');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

async function getDuePolls() {
  const { data, error } = await supabase.from('polls').select('*').eq('closed', false).not('ends_at', 'is', null).lte('ends_at', new Date().toISOString()).order('ends_at', { ascending: true }).limit(100);
  if (error) throw error;
  return data ?? [];
}

async function processDuePolls(client) {
  const due = await getDuePolls();

  await forEachWithConcurrency(due, async (poll) => {
    try {
      await pollsDb.closePoll(poll.id);
      poll.closed = true;

      const channel = await client.channels.fetch(poll.channel_id).catch(() => null);
      if (!channel) return;
      const message = await channel.messages.fetch(poll.message_id).catch(() => null);
      if (!message) return;

      const results = await pollsDb.getResults(poll.id, poll.options.length);
      const { components } = buildPollCard(poll, results);
      await message.edit({ components, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } catch (err) {
      logger.error(`Failed to auto-close poll #${poll.id}:`, err);
    }
  }, config.jobConcurrency);
}

function startPollAutocloseJob(client) {
  const run = exclusiveTask(() => processDuePolls(client));
  setInterval(() => run().catch((err) => logger.error('Poll autoclose job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Poll autoclose job started (checking every 60s).');
}

module.exports = { startPollAutocloseJob, processDuePolls };
