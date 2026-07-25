const remindersDb = require('../db/reminders');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 30_000;

async function processDueReminders(client) {
  const due = await remindersDb.listDue();

  for (const reminder of due) {
    try {
      await remindersDb.markSent(reminder.id);
      const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
      if (channel) {
        await channel.send({ content: `⏰ <@${reminder.user_id}>, reminder: ${reminder.message}`, allowedMentions: { users: [reminder.user_id] } }).catch(() => {});
      }
    } catch (err) {
      logger.error(`Failed to send reminder #${reminder.id}:`, err);
    }
  }
}

function startReminderJob(client) {
  setInterval(() => {
    processDueReminders(client).catch((err) => logger.error('Reminder job error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Reminder job started (checking every 30s).');
}

module.exports = { startReminderJob, processDueReminders };
