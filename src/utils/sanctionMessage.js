const { EMOJI, TYPE_EMOJI } = require('./emojis');

const VERB = {
  ban: 'banned from',
  tempban: 'temporarily banned from',
  unban: 'unbanned from',
  kick: 'kicked from',
  mute: 'muted in',
  tempmute: 'temporarily muted in',
  unmute: 'unmuted in',
  warn: 'warned in',
};

/**
 * Builds the DM sent to a sanctioned user, shared by every sanction command
 * (ban/kick/mute/warn/tempban/tempmute) so they all read the same way:
 *
 *   <emoji>  You have been banned from **Guild Name** for 7 days | Reason: `spamming`
 *
 *   -# Sent from 'Petto' (`123456789012345678`) with 214 members
 */
function buildSanctionDM({ type, guild, client, reason, duration }) {
  const emoji = TYPE_EMOJI[type] ?? EMOJI.ALERT;
  const verb = VERB[type] ?? 'sanctioned in';
  const durationPart = duration ? ` for ${duration}` : '';
  const reasonPart = reason ? ` | Reason: \`${reason}\`` : '';

  return [
    `${emoji}  You have been ${verb} **${guild.name}**${durationPart}${reasonPart}`,
    '',
    `-# Sent from '${client.user.username}' (\`${guild.id}\`) with ${guild.memberCount} members`,
  ].join('\n');
}

module.exports = { buildSanctionDM };
