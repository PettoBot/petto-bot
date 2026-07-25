const { getRules } = require('../db/escalation');
const { createCase } = require('../db/modActions');
const { ensureGuild } = require('../db/guilds');
const { ensureMuteRole } = require('./muteRole');
const { logSanction } = require('./caseLog');
const { buildSanctionDM } = require('./sanctionMessage');
const { formatDuration } = require('./duration');
const logger = require('./logger');

const DEFAULT_TEMPMUTE_MS = 60 * 60 * 1000; // 1h, used if a rule somehow has no duration set

/**
 * Called after every warn (manual or automod) with the user's current active
 * warn count. If that count exactly matches a configured threshold, applies
 * the rule's action through the same case/DM/log path as everything else —
 * "moderator" is the bot itself, matching automodAction.js and expireSanctions.js.
 */
async function checkAndApplyEscalation(client, guild, member, warnCount) {
  if (!member || !warnCount) return;

  const rules = await getRules(guild.id);
  const rule = rules.find((r) => r.warn_count === warnCount);
  if (!rule) return;

  const reason = `Automatic escalation: reached ${warnCount} warning(s).`;

  try {
    const guildConfig = await ensureGuild(guild.id);

    if (rule.action === 'mute') {
      const muteRole = await ensureMuteRole(guild, guildConfig);
      await member.roles.add(muteRole, reason);
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'mute', reason });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason });
      await member.send(buildSanctionDM({ type: 'mute', guild, client, reason })).catch(() => {});
      return;
    }

    if (rule.action === 'tempmute') {
      const durationMs = Number(rule.duration_ms) || DEFAULT_TEMPMUTE_MS;
      await member.timeout(durationMs, reason);
      const expiresAt = new Date(Date.now() + durationMs).toISOString();
      const duration = formatDuration(durationMs);
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'tempmute', reason, expiresAt });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, duration });
      await member.send(buildSanctionDM({ type: 'tempmute', guild, client, reason, duration })).catch(() => {});
      return;
    }

    if (rule.action === 'kick') {
      await member.send(buildSanctionDM({ type: 'kick', guild, client, reason })).catch(() => {});
      await member.kick(reason);
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'kick', reason });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason });
      return;
    }

    if (rule.action === 'ban') {
      await member.send(buildSanctionDM({ type: 'ban', guild, client, reason })).catch(() => {});
      await guild.members.ban(member.id, { reason });
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'ban', reason });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason });
    }
  } catch (err) {
    logger.error(`Escalation action "${rule.action}" failed for ${member.id} in guild ${guild.id}:`, err);
  }
}

module.exports = { checkAndApplyEscalation };
