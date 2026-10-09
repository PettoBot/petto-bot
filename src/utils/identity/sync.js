// Checks every member of a server against the rules, for when rules were just created or something was missed. Members are
// read in one request (with presences, so Custom Status rules can see them) and processed a few at a time.
const { evaluateMember, loadRules } = require('./service');

const MAX_MEMBERS = Number(process.env.IDENTITY_SYNC_MAX_MEMBERS) > 0 ? Number(process.env.IDENTITY_SYNC_MAX_MEMBERS) : 25000;
const CONCURRENCY = Number(process.env.IDENTITY_SYNC_CONCURRENCY) > 0 ? Number(process.env.IDENTITY_SYNC_CONCURRENCY) : 4;
const running = new Set();

/**
 * @param {import('discord.js').Guild} guild
 * @param {{ source?: 'vanity'|'guildtag'|null, onProgress?: (state: { processed: number, total: number }) => void }} options
 * @returns {Promise<{ processed: number, total: number, added: number, removed: number, errors: number, skipped: boolean, durationMs: number }>}
 */
async function syncGuild(guild, { source = null, onProgress } = {}) {
  if (running.has(guild.id)) throw new Error('A synchronization is already running in this server.');
  running.add(guild.id);
  const started = Date.now();
  try {
    const rules = await loadRules(guild.id, source);
    const fetched = await guild.members.fetch({ withPresences: true });
    const members = [...fetched.values()].filter((member) => !member.user.bot);
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
    return { ...totals, total, skipped, durationMs: Date.now() - started };
  } finally {
    running.delete(guild.id);
  }
}

module.exports = { syncGuild, MAX_MEMBERS };
