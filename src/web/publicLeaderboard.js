// The public leaderboard of a server, for the website (petto.sbs/lb/<name>).
// POST /api/public/leaderboard with the dashboard key and `{ "slug": "my-server" }` (or `{ "guildId": "<id>" }`), `source` ("text" or
// "voice") and `page` answers `{ ok: true, guild, source, page, pageSize, total, rows: [...] }`. Only servers that turned the page on
// (`level_config.leaderboard_public`) answer, and only with a name, a picture, a level and the XP of each member.
const levelUsersDb = require('../db/levelUsers');
const database = require('../db/database');
const { lookupMembers } = require('../utils/dashboardMembers');
const logger = require('../utils/logger');

const PAGE_SIZE = 25;
const MAX_PAGE = 20; // the top 500
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
const SNOWFLAKE = /^\d{15,25}$/;
const CACHE_MS = 30_000;
const cache = new Map();

/** The settings row of the server a request names, or null. */
async function findConfig(body, db = database) {
  const slug = String(body?.slug ?? '').toLowerCase();
  const guildId = String(body?.guildId ?? '');
  if (SLUG.test(slug)) {
    const { data, error } = await db.from('level_config').select('*').eq('leaderboard_slug', slug).eq('leaderboard_public', true).maybeSingle();
    if (error) throw error;
    return data;
  }
  if (SNOWFLAKE.test(guildId)) {
    const { data, error } = await db.from('level_config').select('*').eq('guild_id', guildId).eq('leaderboard_public', true).maybeSingle();
    if (error) throw error;
    return data;
  }
  return null;
}

/** Builds the answer, or `{ status, error }` when there is none. `deps` lets a test replace the database and Discord. */
async function buildLeaderboard(client, body, deps = {}) {
  const config = await (deps.findConfig ?? findConfig)(body);
  if (!config) return { status: 404, error: 'not_found' };
  const guild = client.guilds.cache.get(config.guild_id);
  if (!guild) return { status: 404, error: 'not_found' };
  const source = body?.source === 'voice' ? 'voice' : 'text';
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(body?.page)) || 1));
  const key = `${guild.id}:${source}:${page}`;
  const kept = cache.get(key);
  if (!deps.noCache && kept && kept.until > Date.now()) return kept.value;

  const users = deps.users ?? levelUsersDb;
  const offset = (page - 1) * PAGE_SIZE;
  const [rows, total] = await Promise.all([
    source === 'voice' ? users.getVoiceLeaderboardPage(guild.id, { offset, limit: PAGE_SIZE }) : users.getLeaderboardPage(guild.id, { offset, limit: PAGE_SIZE }),
    source === 'voice' ? users.countVoiceRanked(guild.id) : users.countRanked(guild.id),
  ]);
  const members = await (deps.lookupMembers ?? lookupMembers)(guild, rows.map((row) => row.user_id)).catch(() => ({}));
  const value = {
    ok: true,
    guild: {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL?.({ size: 128, extension: 'png' }) ?? null,
      memberCount: guild.memberCount ?? null,
      slug: config.leaderboard_slug ?? null,
      joinUrl: /^https:\/\//.test(config.leaderboard_join_url ?? '') ? config.leaderboard_join_url : null,
    },
    source,
    page,
    pageSize: PAGE_SIZE,
    total: Math.min(total, MAX_PAGE * PAGE_SIZE),
    rows: rows.map((row, index) => {
      const member = members[row.user_id] ?? null;
      return {
        rank: offset + index + 1,
        userId: row.user_id,
        name: member?.displayName ?? member?.username ?? null,
        avatar: member?.avatar ?? null,
        xp: Number(source === 'voice' ? row.voice_xp : row.xp),
        level: Number(source === 'voice' ? row.voice_level : row.level),
        messages: source === 'voice' ? undefined : Number(row.messages ?? 0),
        voiceMinutes: source === 'voice' ? Number(row.vc_minutes ?? 0) : undefined,
        inServer: Boolean(member),
      };
    }),
  };
  if (!deps.noCache) cache.set(key, { value, until: Date.now() + CACHE_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

function registerPublicLeaderboardRoute(app, { isAuthorized, limiter, client }) {
  app.post('/api/public/leaderboard', ...(limiter ? [limiter] : []), async (req, res) => {
    if (!isAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    try {
      const answer = await buildLeaderboard(client, req.body);
      if (answer.error) {
        res.status(answer.status).json({ ok: false, error: answer.error });
        return;
      }
      res.set('Cache-Control', 'public, max-age=30');
      res.json(answer);
    } catch (err) {
      logger.error('Public leaderboard failed:', err);
      res.status(500).json({ ok: false, error: 'leaderboard_failed' });
    }
  });
}

function clearCache() { cache.clear(); }

module.exports = { registerPublicLeaderboardRoute, buildLeaderboard, findConfig, clearCache, PAGE_SIZE, MAX_PAGE };
