// Milestone rewards: when a member's total of partnerships or uploads reaches a number the server chose, Petto gives the role and posts the
// message. Each milestone is given once per member (recorded in `milestone_awards`, claimed before anything is given), a deleted role is
// skipped and reported (utils/deadRoles.js), and nothing here ever throws: a reward that cannot be given never breaks the count.
const { PermissionFlagsBits } = require('discord.js');
const milestonesDb = require('../db/milestones');
const deadRoles = require('./deadRoles');
const { resolve } = require('./embedVariables');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

const MAX_MESSAGE = 1000;

/** Whether Petto can give the role: it exists, is not managed or @everyone, and is below the highest role of Petto. */
function canGive(guild, role) {
  const me = guild.members?.me;
  if (!me || !role || role.managed || role.id === guild.id) return false;
  if (!me.permissions?.has(PermissionFlagsBits.ManageRoles)) return false;
  return role.position < (me.roles?.highest?.position ?? 0);
}

/**
 * Gives the milestones a member has reached. `kind` is `partner` or `upload`, `total` the member's total now. `channel` is where the message
 * goes (the one where the partnership or the upload was). `ctx` adds variables (`partner`). Returns the counts given in this call.
 */
async function awardMilestones({ guild, member, user, kind, total, channel = null, ctx = {}, lang = currentLanguage() }) {
  const awarded = [];
  try {
    if (!guild || !user || !(total > 0)) return awarded;
    const rewards = (await milestonesDb.list(guild.id, kind)).filter((reward) => reward.count <= total);
    if (!rewards.length) return awarded;
    // The member can be missing from memory; the roles are given to the member, never to nobody.
    const target = member ?? await guild.members.fetch(user.id).catch(() => null);
    if (!target) return awarded;
    for (const reward of rewards) {
      try {
        const role = guild.roles.cache.get(reward.role_id);
        if (!role) {
          // The role was deleted: it is skipped (and the staff told, once a day), nobody is blocked by it.
          if (deadRoles.isGone(guild, reward.role_id)) {
            await deadRoles.reportDeadRoles({ client: guild.client, guild, kind: 'milestone', roleIds: [reward.role_id], forget: (roleId) => milestonesDb.remove(guild.id, kind, reward.count).then(() => roleId) });
          }
          continue;
        }
        // Claimed first: of two messages at the same moment, only one gets to give it.
        if (!(await milestonesDb.claim(guild.id, kind, user.id, reward.count))) continue;
        if (!target.roles.cache.has(role.id)) {
          if (!canGive(guild, role)) { await milestonesDb.release(guild.id, kind, user.id, reward.count).catch(() => {}); continue; }
          const result = await deadRoles.addRoles(target, role.id, t(lang, 'milestones.auditReason', { count: reward.count }));
          if (result.dead.length) { await deadRoles.reportDeadRoles({ client: guild.client, guild, kind: 'milestone', roleIds: result.dead, forget: () => milestonesDb.remove(guild.id, kind, reward.count) }); continue; }
          if (result.failed.length) { await milestonesDb.release(guild.id, kind, user.id, reward.count).catch(() => {}); continue; }
        }
        awarded.push(reward.count);
        if (reward.message && channel?.send) {
          const text = String(reward.message).replaceAll('{milestone.count}', String(reward.count)).replaceAll('{milestone.role}', `<@&${role.id}>`).replaceAll('{milestone.role_name}', role.name ?? '');
          const content = (await resolve(text, { guild, member: target, user, channel, ...ctx })).slice(0, 2000);
          if (content) await channel.send({ content, allowedMentions: { users: [user.id] } }).catch(() => null);
        }
        logger.info(`Milestone ${kind} ${reward.count} given to ${user.id} in ${guild.id}.`);
      } catch (error) {
        logger.warn(`Milestone ${kind} ${reward.count} failed in guild ${guild.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.warn(`Milestones failed in guild ${guild?.id}: ${error.message}`);
  }
  return awarded;
}

module.exports = { MAX_MESSAGE, canGive, awardMilestones };
