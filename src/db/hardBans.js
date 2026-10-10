// Hard bans: bans only the server owner and the antinuke admins can lift.
const { getPrimaryPool } = require('./postgres');
const antinuke = require('./antinuke');

async function addHardBan(guildId, userId, bannedBy, reason) {
  await getPrimaryPool().query(
    `insert into hard_bans (guild_id, user_id, banned_by, reason) values ($1, $2, $3, $4)
     on conflict (guild_id, user_id) do update set banned_by = excluded.banned_by, reason = excluded.reason, created_at = now()`,
    [String(guildId), String(userId), String(bannedBy), reason ?? null],
  );
}

async function getHardBan(guildId, userId) {
  const { rows } = await getPrimaryPool().query('select * from hard_bans where guild_id = $1 and user_id = $2', [String(guildId), String(userId)]);
  return rows[0] ?? null;
}

async function removeHardBan(guildId, userId) {
  const { rowCount } = await getPrimaryPool().query('delete from hard_bans where guild_id = $1 and user_id = $2', [String(guildId), String(userId)]);
  return rowCount > 0;
}

async function listHardBanIds(guildId) {
  const { rows } = await getPrimaryPool().query('select user_id from hard_bans where guild_id = $1', [String(guildId)]);
  return new Set(rows.map((row) => row.user_id));
}

/** The server owner and the antinuke admins (the antinuke whitelist) may lift a hard ban. */
async function canLiftHardBan(guild, userId) {
  if (String(guild.ownerId) === String(userId)) return true;
  const config = await antinuke.getConfig(guild.id).catch(() => null);
  return (config?.whitelist_ids ?? []).includes(String(userId));
}

module.exports = { addHardBan, getHardBan, removeHardBan, canLiftHardBan, listHardBanIds };
