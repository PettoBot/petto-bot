// Checks every member of a server against the rules, for when rules were just created or something was missed. Members are
// read in one request (with presences, so Custom Status rules can see them) and processed a few at a time.
const { evaluateMember, loadRules } = require('./service');

const MAX_MEMBERS = Number(process.env.IDENTITY_SYNC_MAX_MEMBERS) > 0 ? Number(process.env.IDENTITY_SYNC_MAX_MEMBERS) : 25000;
const CONCURRENCY = Number(process.env.IDENTITY_SYNC_CONCURRENCY) > 0 ? Number(process.env.IDENTITY_SYNC_CONCURRENCY) : 4;
const running = new Set();

/** An error whose message is meant to be shown to the person who used the command as it is. */
class SyncError extends Error {
  constructor(message) { super(message); this.name = 'SyncError'; this.friendly = true; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_WAIT_SECONDS = 20;

/**
 * Every member of the server. The ones Petto already has (it keeps them, with their presence) are used when they are nearly all
 * of the server, so most syncs do not ask Discord at all. Otherwise they are requested, and when Discord says to wait (it limits
 * how often a server's members can be requested) the request is repeated after the wait if it is short. When it is long, the
 * members Petto already knows are used and the result says so; with none known there is nothing to check, and the error says
 * when to try again.
 */
async function loadMembers(guild, { onWait, wait = sleep } = {}) {
  const known = [...guild.members.cache.values()];
  if (guild.memberCount && known.length >= guild.memberCount * 0.98) return { members: known, from: 'cache', complete: true };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fetched = await guild.members.fetch({ withPresences: true });
      return { members: [...fetched.values()], from: 'discord', complete: true };
    } catch (error) {
      const seconds = Number(error?.data?.retry_after);
      if (!Number.isFinite(seconds) || seconds <= 0) throw error;
      if (seconds <= MAX_WAIT_SECONDS && attempt < 2) {
        onWait?.(seconds);
        await wait(Math.ceil(seconds * 1000) + 400);
        continue;
      }
      if (known.length) return { members: known, from: 'cache', complete: false };
      throw new SyncError(`Discord limits how often the members of a server can be requested. Try again in about ${Math.ceil(seconds)} seconds.`);
    }
  }
  throw new SyncError('Discord did not send the members. Try again in a minute.');
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {{ source?: 'vanity'|'guildtag'|null, onProgress?: (state: { processed: number, total: number }) => void }} options
 * @returns {Promise<{ processed: number, total: number, added: number, removed: number, errors: number, skipped: boolean, durationMs: number }>}
 */
async function syncGuild(guild, { source = null, onProgress, onWait, wait } = {}) {
  if (running.has(guild.id)) throw new SyncError('A synchronization is already running in this server. Wait for it to finish.');
  running.add(guild.id);
  const started = Date.now();
  try {
    const rules = await loadRules(guild.id, source);
    const loaded = await loadMembers(guild, { onWait, wait });
    const members = loaded.members.filter((member) => !member.user.bot);
    const skipped = members.length > MAX_MEMBERS;
    const queue = skipped ? members.slice(0, MAX_MEMBERS) : members;
    const total = queue.length;
    const totals = { processed: 0, added: 0, removed: 0, errors: 0 };
    let cursor = 0;
    const worker = async () => {
      while (cursor < total) {
        const member = queue[cursor++];
        const results = await evaluateMember(member, { source, rules });
        for (const result of results) {
          if (result.error) totals.errors += 1;
          else if (result.changed) totals[result.desired ? 'added' : 'removed'] += 1;
        }
        totals.processed += 1;
        if (totals.processed % 25 === 0 || totals.processed === total) onProgress?.({ processed: totals.processed, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(total, 1)) }, worker));
    return { ...totals, total, skipped, durationMs: Date.now() - started, from: loaded.from, complete: loaded.complete };
  } finally {
    running.delete(guild.id);
  }
}

module.exports = { syncGuild, loadMembers, SyncError, MAX_MEMBERS };
