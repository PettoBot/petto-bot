// Who invited a member that just joined, for the variables of the welcome message ({inviter}, {inviter.invites}, {invite.code}).
const { resolveJoinInvite } = require('./inviteResolve');
const inviteTracking = require('../db/inviteTracking');

/**
 * The invite of a join that was recorded when it happened: a message that waited for the member (utils/joinGate.js) can no longer
 * compare the invites of the server, which only tells the join that has just happened.
 */
async function recordedInvite(member) {
  const row = await inviteTracking.getInviter(member.guild.id, member.id);
  return row ? { code: row.invite_code ?? '', inviter: row.inviter_id ? { id: row.inviter_id } : null } : null;
}

async function inviteInfoFor(member, { recorded = false } = {}) {
  try {
    const invite = recorded ? await recordedInvite(member) : await resolveJoinInvite(member);
    const inviterId = invite?.inviter?.id ?? null;
    if (!inviterId) return { inviterId: null, inviterName: '', invites: '', code: invite?.code ?? '' };
    const stats = await inviteTracking.getStats(member.guild.id, inviterId);
    const user = invite.inviter?.username ? invite.inviter : await member.client.users.fetch(inviterId).catch(() => null);
    return { inviterId, inviterName: user?.globalName ?? user?.username ?? '', invites: stats.total, code: invite.code ?? '' };
  } catch {
    return null;
  }
}

module.exports = { inviteInfoFor };
