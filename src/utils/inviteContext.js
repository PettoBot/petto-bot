// Who invited a member that just joined, for the variables of the welcome message ({inviter}, {inviter.invites}, {invite.code}).
const { resolveJoinInvite } = require('./inviteResolve');
const inviteTracking = require('../db/inviteTracking');

async function inviteInfoFor(member) {
  try {
    const invite = await resolveJoinInvite(member);
    const inviterId = invite?.inviter?.id ?? null;
    if (!inviterId) return { inviterId: null, inviterName: '', invites: '', code: invite?.code ?? '' };
    const stats = await inviteTracking.getStats(member.guild.id, inviterId);
    const user = invite.inviter?.username ? invite.inviter : await member.client.users.fetch(inviterId).catch(() => null);
    return { inviterId, inviterName: user?.globalName ?? user?.username ?? '', invites: stats.joins - stats.leaves + stats.bonus, code: invite.code ?? '' };
  } catch {
    return null;
  }
}

module.exports = { inviteInfoFor };
