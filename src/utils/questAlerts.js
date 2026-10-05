// Sends the quest alerts: asks the quests API for the list, finds the quests nobody was told about yet and posts them in
// the servers that turned the alerts on, with their filters. The first run only remembers what already exists, so turning
// the alerts on never floods a channel with old quests.
const questApi = require('./questApi');
const questsDb = require('../db/quests');
const { questMessage } = require('./questMessages');
const logger = require('./logger');
const config = require('../config');
const { forEachWithConcurrency } = require('./concurrency');

/** Who can set the alerts up: everyone once the API is allowed for all, otherwise the team and the testers. */
function canUseQuests(userId) {
  if (config.questsPublic) return true;
  return userId === config.ownerId || config.developerIds.includes(userId) || config.questTesterIds.includes(userId);
}

/** Whether a quest passes the reward and task filters of a server. Empty filters let everything through. */
function matchesFilters(quest, settings) {
  const rewards = settings.reward_kinds ?? [];
  const tasks = settings.task_kinds ?? [];
  if (rewards.length && !quest.rewards.some((reward) => rewards.includes(reward.kind))) return false;
  if (tasks.length && !quest.tasks.some((task) => tasks.includes(task.kind))) return false;
  return true;
}

async function post(client, settings, quest, kind, db) {
  const guild = client.guilds.cache.get(settings.guild_id) ?? await client.guilds.fetch(settings.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(settings.channel_id).catch(() => null) : null;
  if (!guild || !channel?.isTextBased?.()) return false;
  if (await db.hasPost(settings.guild_id, quest.id, kind)) return false;
  const payload = await questMessage(guild, settings, quest, kind);
  const sent = await channel.send(payload).catch(async (error) => {
    logger.warn({ guildId: guild.id, action: 'quest-alert' }, `A quest alert could not be sent: ${error.message}`);
    // Discord refused the message itself (Invalid Form Body): sending it again would fail the same way every pass and fill
    // the channel's rate limit, so it is remembered as handled. A permissions or network problem is tried again next pass.
    if (error?.code === 50035) await db.savePost(settings.guild_id, quest.id, kind, null).catch(() => {});
    return null;
  });
  if (!sent) return false;
  await db.savePost(settings.guild_id, quest.id, kind, sent.id);
  return true;
}

/**
 * One pass. `deps` lets a test replace the API and the database. Returns what happened, for the logs and the tests.
 */
async function checkQuests(client, deps = {}) {
  const api = deps.api ?? questApi;
  const db = deps.db ?? questsDb;
  const now = deps.now ?? Date.now();
  const configs = await db.listEnabledConfigs();
  const result = { sent: 0, newQuests: 0, baseline: false, skipped: false };
  if (!configs.length) { result.skipped = true; return result; }
  const answer = await api.fetchQuests();
  // Even when the sources did not change (`answer.notModified`) the pass runs on the list it already has: a quest that was
  // published before it started becomes active by itself as time passes, and the ending-soon alerts depend on the time too.
  try {
    return await runPass(client, { api, db, now, configs, answer, result });
  } catch (error) {
    api.resetCache?.();
    throw error;
  }
}

async function runPass(client, { api, db, now, configs, answer, result }) {
  const active = answer.quests.filter((quest) => api.isActive(quest, now));
  const seen = await db.listSeenIds();
  const fresh = active.filter((quest) => !seen.has(quest.id));

  if (!seen.size) {
    // Only the quests that have started: one that starts later is announced when it does.
    await db.markSeen(answer.quests.filter((quest) => quest.startsAt.getTime() <= now));
    return { ...result, baseline: true };
  }
  result.newQuests = fresh.length;

  await forEachWithConcurrency(configs, async (settings) => {
    for (const quest of fresh) {
      if (!matchesFilters(quest, settings)) continue;
      if (await post(client, settings, quest, 'new', db).catch((error) => { logger.warn(`Quest alert failed: ${error.message}`); return false; })) result.sent += 1;
    }
    const hours = settings.expiring_hours ?? 0;
    if (hours > 0) {
      for (const quest of active) {
        const left = quest.expiresAt.getTime() - now;
        if (left <= 0 || left > hours * 3_600_000 || !matchesFilters(quest, settings)) continue;
        if (await post(client, settings, quest, 'expiring', db).catch(() => false)) result.sent += 1;
      }
    }
  }, 3);

  if (fresh.length) await db.markSeen(fresh);
  return result;
}

module.exports = { canUseQuests, matchesFilters, checkQuests };
