// The saved messages for moderation, per sanction type. Read through a short cache: every sanction looks at them.
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');

const TYPES = ['default', 'ban', 'tempban', 'softban', 'unban', 'kick', 'mute', 'tempmute', 'unmute', 'warn', 'jail', 'unjail'];
const SLOTS = { dm: 'dm_template', reply: 'reply_template', log: 'log_template' };
const cache = createExpiringCache(30_000);

async function loadAll(guildId) {
  const { rows } = await getPrimaryPool().query('select type, dm_template, reply_template, log_template from sanction_templates where guild_id = $1', [String(guildId)]);
  return new Map(rows.map((row) => [row.type, { dm: row.dm_template, reply: row.reply_template, log: row.log_template }]));
}

/** Every saved set of a server, by type. */
function listTemplates(guildId, { force = false } = {}) {
  return cache.get(String(guildId), () => loadAll(guildId), { force, staleIfError: !force });
}

/** The template name for one slot of one type: the type's own, or the `default` one. Null when there is none. */
async function templateFor(guildId, type, slot) {
  try {
    const all = await listTemplates(guildId);
    return all.get(type)?.[slot] ?? all.get('default')?.[slot] ?? null;
  } catch {
    return null;
  }
}

/** Saves the templates of one type. A slot given as null or empty is cleared; a slot left undefined is kept. */
async function setTemplates(guildId, type, slots) {
  if (!TYPES.includes(type)) throw new Error(`Unknown sanction type ${type}.`);
  const current = (await listTemplates(guildId, { force: true })).get(type) ?? {};
  const next = { dm: current.dm ?? null, reply: current.reply ?? null, log: current.log ?? null };
  for (const slot of Object.keys(SLOTS)) {
    if (slots[slot] !== undefined) next[slot] = slots[slot] ? String(slots[slot]).slice(0, 40) : null;
  }
  if (!next.dm && !next.reply && !next.log) {
    await getPrimaryPool().query('delete from sanction_templates where guild_id = $1 and type = $2', [String(guildId), type]);
  } else {
    await getPrimaryPool().query(
      `insert into sanction_templates (guild_id, type, dm_template, reply_template, log_template) values ($1, $2, $3, $4, $5)
       on conflict (guild_id, type) do update set dm_template = excluded.dm_template, reply_template = excluded.reply_template, log_template = excluded.log_template, updated_at = now()`,
      [String(guildId), type, next.dm, next.reply, next.log],
    );
  }
  await listTemplates(guildId, { force: true });
  return next;
}

module.exports = { TYPES, SLOTS, listTemplates, templateFor, setTemplates };
