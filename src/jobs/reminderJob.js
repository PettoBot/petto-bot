const remindersDb = require('../db/reminders');
const { sendAs } = require('../utils/senderIdentity');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { t, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 30_000;

async function processDueReminders(client) {
  const due = await remindersDb.listDue();

  await forEachWithConcurrency(due, async (reminder) => {
    try {
      await remindersDb.markSent(reminder.id);
      const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
      if (channel) {
        // A job runs outside of any server's language: the reminder's server decides (English when it has none).
        const lang = await guildLanguage(reminder.guild_id ?? channel.guildId);
        await sendAs(channel, 'reminders', { content: t(lang, 'utility.remind.fired', { emoji: '⏰', user: `<@${reminder.user_id}>`, message: reminder.message }), allowedMentions: { users: [reminder.user_id] } }).catch(() => {});
      }
    } catch (err) {
      logger.error(`Failed to send reminder #${reminder.id}:`, err);
    }
  }, config.jobConcurrency);
}

function startReminderJob(client) {
  const run = exclusiveTask(() => processDueReminders(client));
  setInterval(() => run().catch((err) => logger.error('Reminder job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Reminder job started (checking every 30s).');
}

module.exports = { startReminderJob, processDueReminders };
