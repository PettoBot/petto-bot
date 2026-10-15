const { sendLog, getAvatar } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const { t, guildLanguage } = require('../i18n');

/** Logs a completed verification to the 'verification' category of /logs, in the language of the server. */
async function logVerification(client, guild, user, lang) {
  const language = lang ?? await guildLanguage(guild.id);
  const embed = {
    author: { name: user.username, icon_url: getAvatar(user) ?? undefined },
    description: t(language, 'verify.log.passed', { emoji: EMOJI.APPROVE, user: `<@${user.id}>` }),
    color: 0xa5ea7a,
    footer: { text: t(language, 'verify.log.userId', { id: user.id }) },
    timestamp: new Date().toISOString(),
  };

  await sendLog(client, guild.id, 'verification', embed);
}

module.exports = { logVerification };
