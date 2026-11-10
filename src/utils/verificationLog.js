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

/** The line of a reason of a check (`{ check, code, ... }` of utils/verifyChecks.js), in a language. */
function reasonLine(lang, reason) {
  if (reason.check === 'alt') {
    const alts = reason.alts.map((alt) => {
      const how = t(lang, alt.by === 'email' ? 'verify.log.alt.email' : 'verify.log.alt.ip');
      return `<@${alt.userId}> (${how}${alt.banned ? `, ${t(lang, 'verify.log.alt.banned')}` : ''})`;
    }).join(', ');
    return t(lang, 'verify.log.reason.alt', { alts });
  }
  return t(lang, `verify.log.reason.${reason.code}`, { days: reason.days, min: reason.min });
}

/** The embed that tells the staff what the checks of the verification found about a member (`blocked`: they were stopped; otherwise they verified with warnings). */
function checksEmbed(user, { blocked, reasons }, language) {
  const head = t(language, blocked ? 'verify.log.blocked' : 'verify.log.flagged', { emoji: blocked ? EMOJI.DENY : EMOJI.ALERT, user: `<@${user.id}>` });
  return {
    author: { name: user.username, icon_url: getAvatar(user) ?? undefined },
    description: [head, ...reasons.map((reason) => `- ${reasonLine(language, reason)}`)].join('\n'),
    color: blocked ? 0xfe6465 : 0xffd563,
    footer: { text: t(language, 'verify.log.userId', { id: user.id }) },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Tells the staff what the checks of the verification found about a member: `blocked` is true when the member was stopped, false when they
 * verified with warnings. `reasons` is the list of the reasons of that kind.
 */
async function logVerificationChecks(client, guild, user, { blocked, reasons }, lang) {
  if (!reasons?.length) return;
  const language = lang ?? await guildLanguage(guild.id);
  await sendLog(client, guild.id, 'verification', checksEmbed(user, { blocked, reasons }, language));
}

module.exports = { logVerification, logVerificationChecks, checksEmbed, reasonLine };
