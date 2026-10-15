// Roles for reaching a number of invites. After an invite count changes, the inviter gets the roles whose number they have
// reached and loses the ones they have fallen below. Only the roles of the rewards are touched.
const inviteTracking = require('../db/inviteTracking');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

/** Which reward roles a person should have and which they should not, for their number of invites. Pure. */
function planRewards(rewards, net) {
  return {
    give: rewards.filter((reward) => net >= reward.invites).map((reward) => reward.role_id),
    take: rewards.filter((reward) => net < reward.invites).map((reward) => reward.role_id),
  };
}

async function applyRewards(guild, inviterId) {
  try {
    const rewards = await inviteTracking.listRewards(guild.id);
    if (!rewards.length) return;
    const member = await guild.members.fetch(inviterId).catch(() => null);
    if (!member) return;
    const stats = await inviteTracking.getStats(guild.id, inviterId);
    const net = stats.joins - stats.leaves + stats.bonus;
    const plan = planRewards(rewards, net);
    const me = guild.members.me;
    const usable = (roleId) => { const role = guild.roles.cache.get(roleId); return role && !role.managed && me && role.position < me.roles.highest.position; };
    const add = plan.give.filter((id) => usable(id) && !member.roles.cache.has(id));
    const remove = plan.take.filter((id) => usable(id) && member.roles.cache.has(id));
    // The reasons are read by the staff in the audit log, in the language of the server.
    const lang = add.length || remove.length ? await guildLanguage(guild.id) : null;
    if (add.length) await member.roles.add(add, t(lang, 'info.invites.reward.auditGiven'));
    if (remove.length) await member.roles.remove(remove, t(lang, 'info.invites.reward.auditTaken'));
  } catch (error) {
    logger.warn({ guildId: guild.id, action: 'invite-rewards' }, `Invite rewards for ${inviterId} failed: ${error.message}`);
  }
}

module.exports = { planRewards, applyRewards };
