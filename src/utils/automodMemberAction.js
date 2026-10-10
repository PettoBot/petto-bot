const { ensureGuild } = require('../db/guilds');
const { createCase } = require('../db/modActions');
const { logSanction } = require('./caseLog');
const { sanctionDM } = require('./sanctionTemplates');
const logger = require('./logger');

/**
 * Applies an automatic kick and records it exactly like a manual moderation
 * action. The case is created only after Discord confirms the kick succeeded.
 */
async function applyAutomatedKick(member, reason) {
  const { guild, user } = member;
  const client = member.client;

  await user
    .send(await sanctionDM({ type: 'kick', guild, client, reason, user, member, source: 'automod' }))
    .catch(() => {});

  try {
    await member.kick(reason);
  } catch (err) {
    logger.warn(`Automod: kick failed for ${user.id} in guild ${guild.id}:`, err.message);
    return false;
  }

  try {
    await ensureGuild(guild.id);
    const modCase = await createCase({ guildId: guild.id, userId: user.id, moderatorId: client.user.id, type: 'kick', reason, source: 'automod' });
    await logSanction(client, guild, { modCase, target: user, moderator: client.user, reason, source: 'automod' });
  } catch (err) {
    // The Discord action already happened. Keep the process alive, but make the
    // missing audit record visible so it can be repaired from the logs.
    logger.error(`Automod: kick succeeded but case logging failed for ${user.id} in guild ${guild.id}:`, err);
  }

  return true;
}

module.exports = { applyAutomatedKick };
