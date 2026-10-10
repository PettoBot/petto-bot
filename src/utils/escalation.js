const { getRules } = require('../db/escalation');
const { createCase } = require('../db/modActions');
const { ensureGuild } = require('../db/guilds');
const { ensureMuteRole } = require('./muteRole');
const { logSanction } = require('./caseLog');
const { sanctionDM } = require('./sanctionTemplates');
const { formatDuration } = require('./duration');
const { jailMember, JailError } = require('./jail');
const logger = require('./logger');

const DEFAULT_TEMPMUTE_MS = 60 * 60 * 1000; // 1h, used if a rule somehow has no duration set
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

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
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'mute', reason, source: 'escalation' });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, source: 'escalation' });
      await member.send(await sanctionDM({ type: 'mute', guild, client, reason, member, source: 'escalation', caseNumber: modCase.case_number })).catch(() => {});
      return;
    }

    if (rule.action === 'tempmute') {
      const durationMs = Number(rule.duration_ms) || DEFAULT_TEMPMUTE_MS;
      if (durationMs > MAX_TIMEOUT_MS) {
        logger.error(`Escalation tempmute duration exceeds Discord's 28-day limit for guild ${guild.id}.`);
        return;
      }
      await member.timeout(durationMs, reason);
      const expiresAt = new Date(Date.now() + durationMs).toISOString();
      const duration = formatDuration(durationMs);
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'tempmute', reason, expiresAt, source: 'escalation' });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, duration, source: 'escalation' });
      await member.send(await sanctionDM({ type: 'tempmute', guild, client, reason, duration, member, source: 'escalation', caseNumber: modCase.case_number })).catch(() => {});
      return;
    }

    if (rule.action === 'jail') {
      const durationMs = Number(rule.duration_ms) || null;
      const duration = durationMs ? formatDuration(durationMs) : undefined;
      try {
        const { modCase } = await jailMember({ guild, member, moderator: client.user, reason, durationMs });
        await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, duration, source: 'escalation' });
        await member.send(await sanctionDM({ type: 'jail', guild, client, reason, duration, member, source: 'escalation', caseNumber: modCase.case_number })).catch(() => {});
      } catch (err) {
        // Most often jail was never set up, or the member is already in jail; either is worth a line in the log, not a crash.
        if (err instanceof JailError) logger.warn(`Escalation jail skipped for ${member.id} in guild ${guild.id}: ${err.message}`);
        else throw err;
      }
      return;
    }

    if (rule.action === 'kick') {
      await member.send(await sanctionDM({ type: 'kick', guild, client, reason, member, source: 'escalation' })).catch(() => {});
      await member.kick(reason);
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'kick', reason, source: 'escalation' });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, source: 'escalation' });
      return;
    }

    if (rule.action === 'ban') {
      await member.send(await sanctionDM({ type: 'ban', guild, client, reason, member, source: 'escalation' })).catch(() => {});
      await guild.members.ban(member.id, { reason });
      const modCase = await createCase({ guildId: guild.id, userId: member.id, moderatorId: client.user.id, type: 'ban', reason, source: 'escalation' });
      await logSanction(client, guild, { modCase, target: member.user, moderator: client.user, reason, source: 'escalation' });
    }
  } catch (err) {
    logger.error(`Escalation action "${rule.action}" failed for ${member.id} in guild ${guild.id}:`, err);
  }
}

module.exports = { checkAndApplyEscalation };
