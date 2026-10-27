// i18n-ignore-file: SQL only, no text anybody reads
// The servers Petto is no longer in and since when (table `guild_departures` of schema.sql), and the deletion of what Petto stored for them.
const { getPrimaryPool } = require('./postgres');
const commandData = require('./commandData');

// Tables that have a guild_id but are not erased with the server: what a person paid for or asked for stays until it is handled on its own.
const KEEP = new Set(['guilds', 'guild_departures', 'premium_slot_assignments', 'premium_slot_requests', 'custom_command_data']);

const pool = () => getPrimaryPool();

/** Writes down that Petto left the server (keeps the first date when it is already written down). */
async function mark(guildId) {
  await pool().query('insert into guild_departures (guild_id) values ($1) on conflict (guild_id) do nothing', [String(guildId)]);
}

/** Petto is in the server (again): nothing of it is deleted. */
async function clear(guildId) {
  await pool().query('delete from guild_departures where guild_id = $1', [String(guildId)]);
}

/** The ids of the servers that have settings stored. */
async function knownGuilds() {
  const { rows } = await pool().query('select guild_id from guilds');
  return rows.map((row) => row.guild_id);
}

/** Writes down every server in `ids` that has no date yet, and forgets the dates of the servers in `present`. */
async function sync(missingIds, presentIds) {
  if (missingIds.length) await pool().query('insert into guild_departures (guild_id) select unnest($1::text[]) on conflict (guild_id) do nothing', [missingIds]);
  if (presentIds.length) await pool().query('delete from guild_departures where guild_id = any($1::text[])', [presentIds]);
}

/** The servers that left at least `days` days ago (oldest first). */
async function due(days, limit) {
  const { rows } = await pool().query(`select guild_id from guild_departures where left_at < now() - make_interval(days => $1) order by left_at limit $2`, [days, limit]);
  return rows.map((row) => row.guild_id);
}

/** Why a server's data must stay for now (a Premium slot in use, backups kept in this database), or null. */
async function holdReason(guildId) {
  const { rows } = await pool().query(
    `select case
       when exists (select 1 from premium_slot_assignments where guild_id = $1 and status = 'active') then 'premium'
       when exists (select 1 from guild_backups where guild_id = $1) then 'backups'
     end as reason`, [guildId]);
  return rows[0]?.reason ?? null;
}

let tables;
/** The tables with a guild_id that do not go with the row of `guilds` by themselves (the rest are deleted with it, by their foreign key). */
async function looseTables() {
  if (!tables) {
    const { rows } = await pool().query(
      `select c.table_name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'guild_id'
          and c.table_name not in (select conrelid::regclass::text from pg_constraint where confrelid = 'guilds'::regclass and contype = 'f')`);
    tables = rows.map((row) => row.table_name).filter((name) => !KEEP.has(name) && /^[a-z_0-9]+$/.test(name));
  }
  return tables;
}

/** Deletes everything stored for the server (its code data first, which can be in another database), and its departure date. */
async function erase(guildId) {
  await commandData.deleteGuildData(guildId);
  const client = await pool().connect();
  try {
    await client.query('begin');
    for (const table of await looseTables()) await client.query(`delete from ${table} where guild_id = $1`, [String(guildId)]);
    await client.query('delete from guilds where guild_id = $1', [String(guildId)]); // the rest goes with it (on delete cascade)
    await client.query('delete from guild_departures where guild_id = $1', [String(guildId)]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { mark, clear, knownGuilds, sync, due, holdReason, erase, looseTables, KEEP };
