const { getExpiredSanctions, deactivateCase, createCase } = require('../db/modActions');
const { logSanction } = require('../utils/caseLog');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 60_000;

/** A minimal mention-able stand-in for a User/GuildMember, for cases where the member may have left. */
function userMention(userId) {
  return { id: userId, toString: () => `<@${userId}>` };
}

async function processExpiredSanctions(client) {
  const expired = await getExpiredSanctions();

  await forEachWithConcurrency(expired, async (sanction) => {
    try {
      const guild = await client.guilds.fetch(sanction.guild_id).catch(() => null);
      if (!guild) {
        await deactivateCase(sanction.guild_id, sanction.case_number);
        return;
      }

      if (sanction.type === 'tempban') {
        try {
          await guild.members.unban(sanction.user_id, 'Temporary ban expired');
        } catch (err) {
          // Already unbanned is a successful final state. Other errors must
          // leave the case active so the next poll can retry it.
          if (err.code !== 10026) throw err;
        }
      } else if (sanction.type === 'tempmute') {
        const member = await guild.members.fetch(sanction.user_id).catch(() => null);
        if (member) await member.timeout(null, 'Temporary mute expired');
      }

      await deactivateCase(sanction.guild_id, sanction.case_number);

      const reverseType = sanction.type === 'tempban' ? 'unban' : 'unmute';
      const modCase = await createCase({
        guildId: sanction.guild_id,
        userId: sanction.user_id,
        moderatorId: client.user.id,
        type: reverseType,
        reason: 'Automatic expiry',
      });

      await logSanction(client, guild, { modCase, target: userMention(sanction.user_id), moderator: client.user, reason: 'Automatic expiry' });
    } catch (err) {
      logger.error(`Failed to process expired sanction (case #${sanction.case_number}, guild ${sanction.guild_id}):`, err);
    }
  }, config.jobConcurrency);
}

function startExpiryJob(client) {
  const run = exclusiveTask(() => processExpiredSanctions(client));
  setInterval(() => run().catch((err) => logger.error('Expiry job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Sanction expiry job started (checking every 60s).');
}

module.exports = { startExpiryJob, processExpiredSanctions };
