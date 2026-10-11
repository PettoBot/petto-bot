// Sends the rollout alerts: reads the list of Discord's experiments, finds what changed since the last pass and posts it in the
// servers that turned the alerts on, with their filters. The first pass only remembers what exists, so turning the alerts on never
// floods a channel. The state is kept up to date even when no server uses the alerts, so the first server that does gets only what is new.
const rolloutApi = require('./rolloutApi');
const rolloutsDb = require('../db/rollouts');
const { diffRollouts, matchesEvent, snapshotOf } = require('./rolloutDiff');
const { rolloutMessage } = require('./rolloutMessages');
const logger = require('./logger');
const config = require('../config');
const { forEachWithConcurrency } = require('./concurrency');

const MAX_EVENTS_PER_SERVER = 25; // a day with many changes is cut here, so a channel is never flooded

/** Who can set the alerts up: everyone once they are public, otherwise the team and the testers. */
function canUseRollouts(userId) {
  if (config.rolloutsPublic) return true;
  return userId === config.ownerId || config.developerIds.includes(userId) || config.rolloutTesterIds.includes(userId);
}

async function post(client, settings, event) {
  const guild = client.guilds.cache.get(settings.guild_id) ?? await client.guilds.fetch(settings.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(settings.channel_id).catch(() => null) : null;
  if (!guild || !channel?.isTextBased?.()) return false;
  try {
    await channel.send(await rolloutMessage(guild, settings, event));
    return true;
  } catch (error) {
    logger.warn({ guildId: guild.id, action: 'rollout-alert' }, `A rollout alert could not be sent: ${error.message}`);
    return false;
  }
}

/** One pass. `deps` lets a test replace the list and the database. Returns what happened, for the logs and the tests. */
async function checkRollouts(client, deps = {}) {
  const api = deps.api ?? rolloutApi;
  const db = deps.db ?? rolloutsDb;
  const answer = await api.fetchRollouts();
  const result = { sent: 0, events: 0, baseline: false, skipped: false };
  if (answer.notModified) { result.skipped = true; return result; }

  const previous = await db.loadState();
  if (!previous.size) {
    await db.saveState(answer.list.map((rollout) => [rollout.id, snapshotOf(rollout)]));
    return { ...result, baseline: true };
  }

  const events = diffRollouts(previous, answer.list);
  result.events = events.length;
  const configs = events.length ? await db.listEnabledConfigs() : [];
  await forEachWithConcurrency(configs, async (settings) => {
    let sent = 0;
    for (const event of events) {
      if (sent >= MAX_EVENTS_PER_SERVER) break;
      if (!matchesEvent(event, settings)) continue;
      if (await post(client, settings, event)) { sent += 1; result.sent += 1; }
      await new Promise((resolve) => setTimeout(resolve, deps.pause ?? 1_200));
    }
  }, 2);

  // Only what changed is written, and only after the alerts went out, so a failed pass tells the same news again next time.
  await db.saveState(events.map((event) => [event.rollout.id, snapshotOf(event.rollout)]));
  return result;
}

module.exports = { canUseRollouts, checkRollouts, MAX_EVENTS_PER_SERVER };
