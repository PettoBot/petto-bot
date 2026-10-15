// Takes back the role that was given for a mistake in the counting game once its time is over.
const db = require('../db/counting');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const { t, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 60_000;

async function processCountingRoles(client) {
  for (const due of await db.listDueRoles()) {
    try {
      const guild = client.guilds.cache.get(due.guild_id);
      const member = guild ? await guild.members.fetch(due.user_id).catch(() => null) : null;
      if (member) await member.roles.remove(due.role_id, t(await guildLanguage(due.guild_id), 'counting.reason.timeOver')).catch(() => {});
      await db.forgetRole(due.guild_id, due.user_id);
    } catch (err) {
      logger.warn(`Could not take back a counting role in ${due.guild_id}: ${err.message}`);
    }
  }
}

function startCountingRoleJob(client) {
  const run = exclusiveTask(() => processCountingRoles(client));
  setTimeout(() => run().catch((err) => logger.error('Counting role job error:', err)), 50_000).unref?.();
  setInterval(() => run().catch((err) => logger.error('Counting role job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Counting role job started (checking every minute).');
}

module.exports = { startCountingRoleJob, processCountingRoles };
