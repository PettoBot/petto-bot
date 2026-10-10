const { EMOJI, TYPE_EMOJI } = require('./emojis');

const VERB = {
  ban: 'banned from', hardban: 'permanently banned from', tempban: 'temporarily banned from', softban: 'kicked from', unban: 'unbanned from',
  kick: 'kicked from', mute: 'muted in', tempmute: 'temporarily muted in', unmute: 'unmuted in',
  warn: 'warned in', jail: 'jailed in', unjail: 'released from jail in',
};

/**
 * The DM sent to a sanctioned member when the server has no saved one: a single line with what happened and why, and
 * where it comes from underneath. Goes straight into `.send(...)`.
 *
 *   <emoji>  You have been banned from **Guild Name** for 7 days | Reason: `spamming`
 *   -# Sent from 'Petto' (`123`) with 214 members
 */
function buildSanctionDM({ type, guild, reason, duration }) {
  const emoji = TYPE_EMOJI[type] ?? EMOJI.ALERT;
  const durationPart = duration ? ` for ${duration}` : '';
  const reasonPart = reason ? ` | Reason: \`${reason}\`` : '';
  const botName = guild?.client?.user?.username ?? 'Petto';
  return {
    content: [
      `${emoji}  You have been ${VERB[type] ?? 'sanctioned in'} **${guild?.name ?? 'the server'}**${durationPart}${reasonPart}`,
      '',
      `-# Sent from '${botName}' (\`${guild?.id}\`) with ${guild?.memberCount ?? 0} members`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  };
}

module.exports = { buildSanctionDM };
