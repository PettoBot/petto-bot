const { Events } = require('discord.js');
const { evaluateMember } = require('../utils/identity/service');

function sameRoles(a, b) {
  return a.roles.cache.size === b.roles.cache.size && a.roles.cache.every((_, id) => b.roles.cache.has(id));
}

// A new nickname, a name change or a role added or removed by hand can change what the rules say, so the member is checked again.
module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const changed = oldMember.partial
      || oldMember.nickname !== newMember.nickname
      || oldMember.user?.username !== newMember.user?.username
      || oldMember.user?.globalName !== newMember.user?.globalName
      || oldMember.user?.primaryGuild?.tag !== newMember.user?.primaryGuild?.tag
      || oldMember.user?.primaryGuild?.identityGuildId !== newMember.user?.primaryGuild?.identityGuildId
      || oldMember.user?.primaryGuild?.identityEnabled !== newMember.user?.primaryGuild?.identityEnabled
      || !sameRoles(oldMember, newMember);
    if (!changed) return;
    await evaluateMember(newMember);
  },
};
