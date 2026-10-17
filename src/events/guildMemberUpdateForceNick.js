// A forced nickname (!nickname force) is put back as soon as it changes.
const { Events, PermissionFlagsBits } = require('discord.js');
const forced = require('../db/forcedNicknames');
const logger = require('../utils/logger');
const { t, guildLanguage } = require('../i18n');

/** Puts the forced nickname back on the member when it differs. Shared with the join event. */
async function enforce(member) {
  const nickname = await forced.getForced(member.guild.id, member.id).catch(() => null);
  if (!nickname || member.nickname === nickname) return false;
  if (!member.guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames) || !member.manageable) return false;
  const lang = await guildLanguage(member.guild.id).catch(() => 'en');
  await member.setNickname(nickname, t(lang, 'moderation.nickname.auditForced')).catch((err) => logger.warn(`Could not put back the forced nickname of ${member.id} in ${member.guild.id}: ${err.message}`));
  return true;
}

module.exports = {
  name: Events.GuildMemberUpdate,
  enforce,
  async execute(oldMember, newMember) {
    if (oldMember.nickname === newMember.nickname && !oldMember.partial) return;
    await enforce(newMember);
  },
};
