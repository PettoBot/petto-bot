const { sendLog, getAvatar } = require('../logging/engine');
const { EMOJI } = require('./emojis');

/** Logs a completed verification to the 'verification' category of /logs. */
async function logVerification(client, guild, user) {
  const embed = {
    author: { name: user.username, icon_url: getAvatar(user) ?? undefined },
    description: `${EMOJI.APPROVE} <@${user.id}> passed verification.`,
    color: 0xa5ea7a,
    footer: { text: `User ID: ${user.id}` },
    timestamp: new Date().toISOString(),
  };

  await sendLog(client, guild.id, 'verification', embed);
}

module.exports = { logVerification };
