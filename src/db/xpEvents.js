// Temporary XP multipliers of a server, with a start and an end. They live in their own table and are read through a
// short cache, since every message and every voice minute looks at them.
const { getPrimaryPool } = require('./postgres');
const { createExpiringCache } = require('../utils/expiringCache');

const MAX_EVENTS = 25;
const cache = createExpiringCache(30_000);

async function loadEvents(guildId) {
  const { rows } = await getPrimaryPool().query(
    'select id, name, multiplier, source, starts_at, ends_at from xp_events where guild_id = $1 and ends_at > now() order by starts_at',
    [String(guildId)],
  );
  return rows;
}

/** The events of a server that have not ended yet (running or coming). */
function listEvents(guildId, { force = false } = {}) {
  return cache.get(String(guildId), () => loadEvents(guildId), { force, staleIfError: !force });
}

async function addEvent(guildId, { name, multiplier, source, startsAt, endsAt }, createdBy = null) {
  const { rows: count } = await getPrimaryPool().query('select count(*)::int as total from xp_events where guild_id = $1 and ends_at > now()', [String(guildId)]);
  if ((count[0]?.total ?? 0) >= MAX_EVENTS) return { ok: false, code: 'limit', limit: MAX_EVENTS };
  const { rows } = await getPrimaryPool().query(
    `insert into xp_events (guild_id, name, multiplier, source, starts_at, ends_at, created_by) values ($1, $2, $3, $4, $5, $6, $7)
     returning id, name, multiplier, source, starts_at, ends_at`,
    [String(guildId), String(name).slice(0, 60), multiplier, source, startsAt, endsAt, createdBy],
  );
  await listEvents(guildId, { force: true });
  return { ok: true, event: rows[0] };
}

async function removeEvent(guildId, id) {
  if (!/^\d{1,18}$/.test(String(id))) return false;
  const { rowCount } = await getPrimaryPool().query('delete from xp_events where guild_id = $1 and id = $2', [String(guildId), String(id)]);
  await listEvents(guildId, { force: true });
  return rowCount > 0;
}

module.exports = { MAX_EVENTS, listEvents, addEvent, removeEvent };
