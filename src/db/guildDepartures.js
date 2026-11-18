// i18n-ignore-file: SQL only, no text anybody reads
// The servers Petto is no longer in and since when (table `guild_departures` of schema.sql), and the deletion of what Petto stored for them.
const { getPrimaryPool } = require('./postgres');
const commandData = require('./commandData');

// Tables that have a guild_id but are not erased with the server: what a person paid for or asked for (the Premium slots and their requests, the blacklist) stays until it is handled on its own.
const KEEP = new Set(['guilds', 'guild_departures', 'premium_slot_assignments', 'premium_slot_requests', 'custom_command_data', 'guild_blacklist']);

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

/**
 * The servers that left at least `minutes` minutes ago and whose data goes now (oldest first). All of them: a Premium slot in use or backups do not hold a
 * server any more, what a server stored goes with it. (What a person paid for is not in the tables of the server, see `KEEP`.)
 */
async function due(minutes, limit) {
  const { rows } = await pool().query(
    `select guild_id from guild_departures where left_at < now() - make_interval(mins => $1::int) order by left_at limit $2`, [minutes, limit]);
  return rows.map((row) => row.guild_id);
}

/** How the servers that left are doing: those still inside the `minutes` of grace, and those that are due. */
async function counts(minutes) {
  const { rows } = await pool().query(
    `select count(*) filter (where left_at >= now() - make_interval(mins => $1::int))::int as waiting,
            count(*) filter (where left_at < now() - make_interval(mins => $1::int))::int as due
       from guild_departures`, [minutes]);
  return rows[0];
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

module.exports = { mark, clear, knownGuilds, sync, due, counts, erase, looseTables, KEEP };
