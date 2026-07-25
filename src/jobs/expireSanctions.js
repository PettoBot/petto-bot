const { getExpiredSanctions, deactivateCase, createCase } = require('../db/modActions');
const { logSanction } = require('../utils/caseLog');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 60_000;

/** A minimal mention-able stand-in for a User/GuildMember, for cases where the member may have left. */
function userMention(userId) {
  return { id: userId, toString: () => `<@${userId}>` };
}

async function processExpiredSanctions(client) {
  const expired = await getExpiredSanctions();

  for (const sanction of expired) {
    try {
      const guild = await client.guilds.fetch(sanction.guild_id).catch(() => null);
      if (!guild) {
        await deactivateCase(sanction.guild_id, sanction.case_number);
        continue;
      }

      if (sanction.type === 'tempban') {
        await guild.members.unban(sanction.user_id, 'Temporary ban expired').catch(() => {});
      } else if (sanction.type === 'tempmute') {
        const member = await guild.members.fetch(sanction.user_id).catch(() => null);
        if (member) await member.timeout(null, 'Temporary mute expired').catch(() => {});
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
  }
}

function startExpiryJob(client) {
  setInterval(() => {
    processExpiredSanctions(client).catch((err) => logger.error('Expiry job error:', err));
  }, POLL_INTERVAL_MS);
  logger.info('Sanction expiry job started (checking every 60s).');
}

module.exports = { startExpiryJob, processExpiredSanctions };
