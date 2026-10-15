// The pictures a server uploads for its appeal page: banner, icon and the picture of the link preview. One per kind and server,
// kept as bytes in PostgreSQL (like the pictures of the image cards, but they do not count against that quota).
const { getPrimaryPool } = require('./postgres');

const KINDS = ['banner', 'icon', 'embed'];

async function getImage(guildId, kind) {
  if (!KINDS.includes(kind)) return null;
  const { rows } = await getPrimaryPool().query('select mime, width, height, size, bytes, updated_at from appeal_images where guild_id = $1 and kind = $2', [String(guildId), kind]);
  return rows[0] ?? null;
}

async function setImage(guildId, kind, { mime, width, height, bytes }) {
  const { rows } = await getPrimaryPool().query(
    `insert into appeal_images (guild_id, kind, mime, width, height, size, bytes, updated_at) values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (guild_id, kind) do update set mime = excluded.mime, width = excluded.width, height = excluded.height, size = excluded.size, bytes = excluded.bytes, updated_at = now()
     returning width, height, size, updated_at`,
    [String(guildId), kind, mime, width, height, bytes.length, bytes],
  );
  return rows[0];
}

async function deleteImage(guildId, kind) {
  const { rowCount } = await getPrimaryPool().query('delete from appeal_images where guild_id = $1 and kind = $2', [String(guildId), kind]);
  return rowCount > 0;
}

module.exports = { KINDS, getImage, setImage, deleteImage };
