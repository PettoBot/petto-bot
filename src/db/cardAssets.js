// Pictures uploaded for image cards. They are stored as bytes in PostgreSQL. This talks to the pool directly: the bytes
// have to go in as a binary parameter, which the generic query helper does not do.
const { getPrimaryPool } = require('./postgres');

const COLUMNS = 'id, guild_id, name, mime, width, height, size, created_at';

async function listAssets(guildId) {
  const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from card_assets where guild_id = $1 order by id desc`, [String(guildId)]);
  return rows;
}

async function countAssets(guildId) {
  const { rows } = await getPrimaryPool().query('select count(*)::int as total from card_assets where guild_id = $1', [String(guildId)]);
  return rows[0]?.total ?? 0;
}

async function totalBytes(guildId) {
  const { rows } = await getPrimaryPool().query('select coalesce(sum(size), 0)::bigint as total from card_assets where guild_id = $1', [String(guildId)]);
  return Number(rows[0]?.total ?? 0);
}

/** The bytes and type of one asset of a server, or null. The server is part of the lookup so one server cannot read another's. */
async function getAsset(guildId, id) {
  if (!/^\d{1,18}$/.test(String(id))) return null;
  const { rows } = await getPrimaryPool().query('select mime, width, height, size, bytes from card_assets where guild_id = $1 and id = $2', [String(guildId), String(id)]);
  return rows[0] ?? null;
}

async function addAsset(guildId, { name, mime, width, height, bytes }, createdBy = null) {
  const { rows } = await getPrimaryPool().query(
    `insert into card_assets (guild_id, name, mime, width, height, size, bytes, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
    [String(guildId), String(name).slice(0, 60), mime, width, height, bytes.length, bytes, createdBy],
  );
  return rows[0];
}

async function deleteAsset(guildId, id) {
  if (!/^\d{1,18}$/.test(String(id))) return false;
  const { rowCount } = await getPrimaryPool().query('delete from card_assets where guild_id = $1 and id = $2', [String(guildId), String(id)]);
  return rowCount > 0;
}

module.exports = { listAssets, countAssets, totalBytes, getAsset, addAsset, deleteAsset };
