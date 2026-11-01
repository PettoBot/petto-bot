const { getExpiredSanctions, deactivateCase, createCase } = require('../db/modActions');
const { getExpiredJails, removeJailed } = require('../db/jail');
const { getExpiredTempRoles, removeTempRole } = require('../db/tempRoles');
const { unjailMember, JailError } = require('../utils/jail');
const { sanctionDM } = require('../utils/sanctionTemplates');
const { logSanction } = require('../utils/caseLog');
const logger = require('../utils/logger');
const config = require('../config');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');
const { t, guildLanguage, runWithLanguage } = require('../i18n');
const { sendDm } = require('../utils/dmOrigin');

const POLL_INTERVAL_MS = 60_000;
// i18n-ignore: saved as the reason of the case in English, like before; caseFormat.displayReason translates it when shown
const EXPIRY_REASON = 'Automatic expiry';

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
      // A job runs outside of any server: what it writes (audit log, sanction log) uses the server's language.
      const lang = await guildLanguage(guild.id);
      await runWithLanguage(lang, () => expireSanction(client, guild, sanction, lang));
    } catch (err) {
      logger.error(`Failed to process expired sanction (case #${sanction.case_number}, guild ${sanction.guild_id}):`, err);
    }
  }, config.jobConcurrency);
}

/** Lifts one timed ban or mute whose time is up and writes the case of it. */
async function expireSanction(client, guild, sanction, lang) {
  if (sanction.type === 'tempban') {
    try {
      await guild.members.unban(sanction.user_id, t(lang, 'moderation.expiry.audit.tempban'));
    } catch (err) {
      // Already unbanned is a successful final state. Other errors must
      // leave the case active so the next poll can retry it.
      if (err.code !== 10026) throw err;
    }
  } else if (sanction.type === 'tempmute') {
    const member = await guild.members.fetch(sanction.user_id).catch(() => null);
    if (member) await member.timeout(null, t(lang, 'moderation.expiry.audit.tempmute'));
  }

  await deactivateCase(sanction.guild_id, sanction.case_number);

  const reverseType = sanction.type === 'tempban' ? 'unban' : 'unmute';
  const modCase = await createCase({
    guildId: sanction.guild_id,
    userId: sanction.user_id,
    moderatorId: client.user.id,
    type: reverseType,
    reason: EXPIRY_REASON,
    source: 'expiry',
  });

  await logSanction(client, guild, { modCase, target: userMention(sanction.user_id), moderator: client.user, reason: EXPIRY_REASON, source: 'expiry' });
}

/** Releases members whose jail timer has run out and gives their roles back. */
async function processExpiredJails(client) {
  const expired = await getExpiredJails();

  await forEachWithConcurrency(expired, async (jail) => {
    try {
      const guild = await client.guilds.fetch(jail.guild_id).catch(() => null);
      if (!guild) {
        await removeJailed(jail.guild_id, jail.user_id);
        return;
      }

      const lang = await guildLanguage(guild.id);
      const result = await runWithLanguage(lang, () => unjailMember({ guild, userId: jail.user_id, moderator: client.user, reason: EXPIRY_REASON, source: 'expiry' }));
      if (!result.ok) return;

      await logSanction(client, guild, { modCase: result.modCase, target: userMention(jail.user_id), moderator: client.user, reason: EXPIRY_REASON, source: 'expiry' });
      await sendDm(result.member, await sanctionDM({ type: 'unjail', guild, client, reason: EXPIRY_REASON, member: result.member, caseNumber: result.modCase.case_number, source: 'expiry' }))
        .catch(() => {});
    } catch (err) {
      // A release that cannot restore roles stays recorded and is retried on the next poll.
      if (err instanceof JailError) logger.warn(`Jail release postponed for ${jail.user_id} in guild ${jail.guild_id}: ${err.message}`);
      else logger.error(`Failed to release expired jail (user ${jail.user_id}, guild ${jail.guild_id}):`, err);
    }
  }, config.jobConcurrency);
}

/** Takes away the temporary roles (!role temp) whose time is up. A member who left, or a role that is gone, just ends the row. */
async function processExpiredTempRoles(client) {
  const expired = await getExpiredTempRoles();

  await forEachWithConcurrency(expired, async (row) => {
    try {
      const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
      const member = guild ? await guild.members.fetch(row.user_id).catch(() => null) : null;
      if (member?.roles.cache.has(row.role_id)) {
        const lang = await guildLanguage(guild.id);
        // A role Discord refuses to remove now (Petto lost the permission) is retried on the next poll.
        await member.roles.remove(row.role_id, t(lang, 'moderation.role.audit.tempEnded'));
      }
      await removeTempRole(row.guild_id, row.user_id, row.role_id);
    } catch (err) {
      logger.warn(`Temporary role not removed yet (role ${row.role_id}, user ${row.user_id}, guild ${row.guild_id}): ${err.message}`);
    }
  }, config.jobConcurrency);
}

function startExpiryJob(client) {
  const run = exclusiveTask(async () => {
    await processExpiredSanctions(client);
    await processExpiredJails(client);
    await processExpiredTempRoles(client).catch((err) => logger.error('Temporary role expiry error:', err));
  });
  setInterval(() => run().catch((err) => logger.error('Expiry job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Sanction expiry job started (checking every 60s).');
}

module.exports = { startExpiryJob, processExpiredSanctions, processExpiredJails, processExpiredTempRoles };
