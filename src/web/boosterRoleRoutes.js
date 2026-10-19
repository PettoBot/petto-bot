// Booster roles from the dashboard. The settings (on/off, base role, limits, cooldowns, gradients, icons, filtered words, what happens
// when a member stops boosting) are saved by the dashboard straight in booster_role_config; what changes roles in Discord goes through
// these routes, with the same checks as `!boosterrole admin`:
//   POST /api/dashboard/guild/:guildId/boosterroles/list     {}  every booster role with its Discord role and whether its owner boosts
//   POST /api/dashboard/guild/:guildId/boosterroles/set      { member_id, name?, hex?, hex2? }  creates or changes a member's role
//        (no limit, no cooldown, like `admin set`)
//   POST /api/dashboard/guild/:guildId/boosterroles/icon     { member_id, icon }  a picture link or a custom emoji; empty removes it
//   POST /api/dashboard/guild/:guildId/boosterroles/remove   { member_id }  deletes the role
//   POST /api/dashboard/guild/:guildId/boosterroles/link     { member_id, role_id }  an existing role becomes the member's booster role
//   POST /api/dashboard/guild/:guildId/boosterroles/cleanup  {}  deletes the roles of members who no longer boost
// Access: the dashboard key and a `user_id` who manages the server, like the other routes (and like `!boosterrole admin`).
// Every answer is `{ ok, message, code?, ... }`, the message in the language of the request.
const { PermissionFlagsBits } = require('discord.js');
const db = require('../db/boosterRole');
const { ensureGuild } = require('../db/guilds');
const actions = require('../utils/boosterRoleActions');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;
const ACTIONS = new Set(['list', 'set', 'icon', 'remove', 'link', 'cleanup']);

const hexOf = (value) => (value == null ? null : `#${Number(value).toString(16).padStart(6, '0').toUpperCase()}`);

/** What the dashboard shows of a booster role: its row, its Discord role (when it still exists) and its owner. */
function describe(row, guild, member) {
  const role = guild.roles.cache.get(row.role_id) ?? null;
  return {
    user_id: row.user_id,
    role_id: row.role_id,
    exists: Boolean(role),
    name: role?.name ?? null,
    color: role ? hexOf(role.colors?.primaryColor ?? role.color) : row.color ?? null,
    color2: role ? (role.colors?.secondaryColor != null ? hexOf(role.colors.secondaryColor) : null) : row.color2 ?? null,
    icon: role?.iconURL?.({ size: 64 }) ?? null,
    editable: Boolean(role?.editable),
    shared_with: row.shared_with ?? [],
    in_server: member !== undefined ? Boolean(member) : null,
    boosting: member ? Boolean(member.premiumSinceTimestamp) : member === null ? false : null,
    created_at: row.created_at ?? null,
  };
}

/** The members behind a list of ids, from memory and then one gateway request; an id missing from the answer has left. */
async function membersOf(guild, ids) {
  const found = new Map();
  const missing = [];
  for (const id of ids) {
    const cached = guild.members.cache.get(id);
    if (cached) found.set(id, cached);
    else missing.push(id);
  }
  for (let start = 0; start < missing.length; start += 100) {
    const chunk = missing.slice(start, start + 100);
    try {
      const fetched = await guild.members.fetch({ user: chunk, time: 8000 });
      for (const id of chunk) found.set(id, fetched.get(id) ?? null);
    } catch {
      // Unknown: neither boosting nor gone is claimed.
    }
  }
  return found;
}

function registerBoosterRoleRoutes(app, { authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/boosterroles/:action', ...middleware, async (req, res) => {
    const action = String(req.params.action);
    if (!ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
    const access = await authorize(req, res);
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    const say = (key, vars) => t(lang, `web.api.boosterrole.${key}`, vars);
    const fail = (status, code, key, vars) => res.status(status).json({ ok: false, code, message: say(key, vars) });
    const { guild } = access;
    const body = req.body ?? {};

    try {
      if (action === 'list') {
        const rows = await db.listBoosterRoles(guild.id);
        const members = await membersOf(guild, [...new Set(rows.map((row) => row.user_id))]);
        const me = guild.members.me;
        const boosters = guild.members.cache.filter((member) => member.premiumSinceTimestamp);
        const withRole = new Set(rows.map((row) => row.user_id));
        res.json({
          ok: true,
          message: '',
          roles: rows.map((row) => describe(row, guild, members.get(row.user_id))),
          can_manage_roles: Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles)),
          bot_top_position: me?.roles.highest?.position ?? 0,
          boost_count: guild.premiumSubscriptionCount ?? 0,
          premium_tier: guild.premiumTier ?? 0,
          boosters_without_role: [...boosters.keys()].filter((id) => !withRole.has(id)).slice(0, 50),
        });
        return;
      }

      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) { fail(400, 'missing_permissions', 'manageRoles'); return; }

      if (action === 'cleanup') {
        const count = await actions.cleanupBoosterRoles(guild, t(lang, 'utility.boosterrole.audit.cleanup'));
        res.json({ ok: true, message: say('cleaned', { count }), count });
        return;
      }

      const memberId = String(body.member_id ?? '');
      if (!SNOWFLAKE.test(memberId)) { fail(400, 'bad_member', 'pickMember'); return; }
      const member = await guild.members.fetch(memberId).catch(() => null);
      const who = member?.displayName ?? memberId;

      if (action === 'remove') {
        const removed = await actions.removeBoosterRole(guild, memberId, t(lang, 'utility.boosterrole.audit.removedBy', { user: access.member?.user?.tag ?? access.userId }));
        if (!removed) { fail(404, 'no_role', 'none'); return; }
        res.json({ ok: true, message: say('removed', { user: who }) });
        return;
      }

      if (action === 'link') {
        const role = guild.roles.cache.get(String(body.role_id ?? ''));
        if (!role || role.id === guild.id || role.managed) { fail(400, 'bad_role', 'badRole'); return; }
        if (!member) { fail(404, 'not_member', 'notMember'); return; }
        await ensureGuild(guild.id);
        await db.upsertBoosterRole(guild.id, memberId, { role_id: role.id });
        if (role.editable && !member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => {});
        res.json({ ok: true, message: say('linked', { user: who, role: role.name }) });
        return;
      }

      if (action === 'icon') {
        const existing = await db.getBoosterRole(guild.id, memberId);
        const role = existing ? guild.roles.cache.get(existing.role_id) : null;
        if (!existing) { fail(404, 'no_role', 'none'); return; }
        if (!role) { fail(404, 'role_gone', 'gone'); return; }
        const input = String(body.icon ?? '').trim();
        let url = null;
        if (input) {
          const resolved = actions.resolveIconInput(input, lang);
          if (resolved.error) { res.status(400).json({ ok: false, code: 'bad_icon', message: resolved.error }); return; }
          url = resolved.url;
        }
        try {
          await role.setIcon(url);
        } catch (err) {
          fail(400, 'discord_refused', 'discord', { error: err.message });
          return;
        }
        res.json({ ok: true, message: say(url ? 'iconSet' : 'iconRemoved', { user: who }) });
        return;
      }

      // set: a name and/or colors, creating the role when the member has none (no limit and no cooldown, like `admin set`).
      if (!member) { fail(404, 'not_member', 'notMember'); return; }
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
      const hex1 = body.hex ? actions.parseHex(String(body.hex)) : null;
      const hex2 = body.hex2 ? actions.parseHex(String(body.hex2)) : null;
      if ((body.hex && !hex1) || (body.hex2 && !hex2)) { fail(400, 'bad_hex', 'badHex'); return; }
      if (!name && !hex1) { fail(400, 'need_value', 'needValue'); return; }
      await ensureGuild(guild.id);
      const result = await actions.applyRole({ guild, member, colorInt: hex1?.int, color2Int: hex1 ? hex2?.int : undefined, name: name || undefined, bypassLimit: true, lang });
      if (result.error) { res.status(400).json({ ok: false, code: 'refused', message: result.error }); return; }
      if (hex1) await db.upsertBoosterRole(guild.id, memberId, { role_id: result.role.id, color: hex1.hex, color2: hex2?.hex ?? null });
      res.json({ ok: true, message: say(result.updated ? 'updated' : 'created', { user: who, role: result.role.name }) });
    } catch (err) {
      logger.error(`Dashboard booster role ${action} failed for guild ${guild.id}:`, err);
      fail(500, 'failed', 'failed');
    }
  });
}

module.exports = { registerBoosterRoleRoutes };
