// Sends the rollout alerts. A pass reads the list of Discord's experiments, finds what changed since the last pass and puts it in the
// queue of every server that wants it; a second, quicker job takes from each queue a little at a time. So a day with hundreds of changes
// goes out in order, as a few cards that gather several changes, and never as a burst that Discord or the host would cut. The first pass only
// remembers what exists, so turning the alerts on never floods a channel, and the state is kept up to date even when no server uses the
// alerts, so the first server that does gets only what is new.
const rolloutApi = require('./rolloutApi');
const { sendAs } = require('./senderIdentity');
const rolloutsDb = require('../db/rollouts');
const { diffRollouts, matchesEvent, snapshotOf, staleSnapshots } = require('./rolloutDiff');
const { rolloutMessage, buildRolloutDigest } = require('./rolloutMessages');
const logger = require('./logger');
const config = require('../config');
const { forEachWithConcurrency } = require('./concurrency');
const { guildLanguage } = require('../i18n');

const MAX_QUEUED_PER_SERVER = 1_500; // beyond this the oldest news is not worth waiting for
const DIGEST_FROM = 4; // this many waiting at once go out together as cards of several changes
const DIGEST_SIZE = 10; // changes in one digest card
const MAX_AGE_HOURS = 24; // news older than this is dropped
const MAX_ATTEMPTS = 5;

/** Who can set the alerts up: everyone once they are public, otherwise the team and the testers. */
function canUseRollouts(userId) {
  if (config.rolloutsPublic) return true;
  return userId === config.ownerId || config.developerIds.includes(userId) || config.rolloutTesterIds.includes(userId);
}

/** What goes in the queue for an event: just what is needed to build the message later. */
function queuedEvent(event) {
  return { type: event.type, change: event.change, rollout: event.rollout, before: event.before };
}

const eventKey = (event) => `${event.rollout.id}:${event.type}:${event.rollout.percent ?? 'x'}:${event.rollout.status ?? 'x'}`;

/** One pass of reading. `deps` lets a test replace the list and the database. Returns what happened, for the logs and the tests. */
async function checkRollouts(client, deps = {}) {
  const api = deps.api ?? rolloutApi;
  const db = deps.db ?? rolloutsDb;
  const answer = await api.fetchRollouts();
  const result = { queued: 0, events: 0, baseline: false, skipped: false };
  if (answer.notModified) { result.skipped = true; return result; }

  const previous = await db.loadState();
  if (!previous.size) {
    await db.saveState(answer.list.map((rollout) => [rollout.id, snapshotOf(rollout)]));
    return { ...result, baseline: true };
  }

  const events = diffRollouts(previous, answer.list);
  result.events = events.length;
  const configs = events.length ? await db.listEnabledConfigs() : [];
  for (const settings of configs) {
    const wanted = events.filter((event) => matchesEvent(event, settings));
    if (!wanted.length) continue;
    const room = Math.max(0, MAX_QUEUED_PER_SERVER - await db.countPending(settings.guild_id));
    const rows = wanted.slice(0, room).map((event) => ({ guild_id: settings.guild_id, event_key: eventKey(event), event: queuedEvent(event) }));
    await db.enqueue(rows);
    result.queued += rows.length;
  }
  // Only what changed is written, and only after it is in the queues, so a failed pass tells the same news again next time (the key keeps it from being queued twice).
  const changed = new Set(events.map((event) => event.rollout.id));
  await db.saveState([...events.map((event) => [event.rollout.id, snapshotOf(event.rollout)]), ...staleSnapshots(previous, answer.list).filter(([id]) => !changed.has(id))]);
  return result;
}

async function channelOf(client, settings) {
  const guild = client.guilds.cache.get(settings.guild_id) ?? await client.guilds.fetch(settings.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(settings.channel_id).catch(() => null) : null;
  return guild && channel?.isTextBased?.() ? { guild, channel } : null;
}

/**
 * One turn of sending: for each server with news waiting, one message. A few waiting go as their own cards, one by one; many go together in
 * cards of up to 10 changes. What was sent leaves the queue; what Discord refused is tried again later, up to 5 times.
 */
async function drainQueue(client, deps = {}) {
  const db = deps.db ?? rolloutsDb;
  const result = { messages: 0, events: 0, dropped: 0 };
  await db.dropOlderThan(MAX_AGE_HOURS).catch(() => {});
  const guildIds = await db.pendingGuilds();
  if (!guildIds.length) return result;
  const configs = new Map((await db.listEnabledConfigs()).map((settings) => [settings.guild_id, settings]));

  await forEachWithConcurrency(guildIds, async (guildId) => {
    const settings = configs.get(guildId);
    if (!settings) { await db.clearGuildQueue(guildId); return; } // turned off (or no channel): nothing is owed to it
    const waiting = await db.peek(guildId, DIGEST_SIZE);
    if (!waiting.length) return;
    const target = await channelOf(client, settings);
    if (!target) { await db.removeQueued(waiting.map((row) => row.id)); result.dropped += waiting.length; return; } // the channel is gone: nothing can be sent

    // The queue is emptied on a timer, outside of any server: each message is written in the language of its server.
    const lang = await guildLanguage(guildId);
    const asDigest = waiting.length >= DIGEST_FROM;
    const batch = asDigest ? waiting : waiting.slice(0, 1);
    try {
      const events = batch.map((row) => row.event);
      const payload = asDigest
        ? buildRolloutDigest(events, settings, { rolePing: settings.role_id ? `<@&${settings.role_id}>` : null, lang })
        : await rolloutMessage(target.guild, settings, events[0], lang);
      await sendAs(target.channel, 'rollouts', payload);
      await db.removeQueued(batch.map((row) => row.id));
      result.messages += 1;
      result.events += batch.length;
    } catch (error) {
      logger.warn({ guildId, action: 'rollout-alert' }, `A rollout alert could not be sent: ${error.message}`);
      const tired = batch.filter((row) => row.attempts + 1 >= MAX_ATTEMPTS);
      if (tired.length) { await db.removeQueued(tired.map((row) => row.id)); result.dropped += tired.length; }
      for (const row of batch.filter((entry) => !tired.includes(entry))) await db.markFailed([row.id], row.attempts + 1);
    }
  }, 2);
  return result;
}

module.exports = { canUseRollouts, checkRollouts, drainQueue, MAX_QUEUED_PER_SERVER, DIGEST_FROM, DIGEST_SIZE };
