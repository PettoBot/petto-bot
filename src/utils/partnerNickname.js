// The nickname format of the Partner Managers (`{name}` and `{count}`), applied when a partnership is counted. Petto needs Manage Nicknames and a member below
// its highest role (never the owner); anything that fails is skipped without a word, a nickname is never worth breaking the count.
const { PermissionFlagsBits } = require('discord.js');
const { formatNickname } = require('./partnerEngine');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

/** Whether Petto can change the nickname of this member. */
function canRename(guild, member) {
  const me = guild.members?.me;
  return Boolean(me?.permissions?.has(PermissionFlagsBits.ManageNicknames) && member?.manageable);
}

/** Sets the nickname of the manager for their new total. Returns the nickname set, or null when nothing was changed. */
async function applyNickname({ guild, member, user, config, total, lang = currentLanguage() }) {
  try {
    if (!config?.nickname_format || !guild) return null;
    const target = member ?? await guild.members.fetch(user.id).catch(() => null);
    if (!target || !canRename(guild, target)) return null;
    const nickname = formatNickname(config.nickname_format, user?.globalName ?? user?.displayName ?? user?.username ?? target.user?.username, total);
    if (!nickname || nickname === target.nickname) return null;
    await target.setNickname(nickname, t(lang, 'partners.nickname.reason'));
    return nickname;
  } catch (error) {
    logger.warn(`Could not set the nickname of a Partner Manager in ${guild?.id}: ${error.message}`);
    return null;
  }
}

module.exports = { canRename, applyNickname };
