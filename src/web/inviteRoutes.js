// Invite tracking from the dashboard (the Invites tab of Statistics), with the same checks as `/invites`:
//   POST /api/dashboard/guild/:guildId/invites/reward    { role_id, invites }  a role given at that many invites (or a new number for it);
//        everyone already counted gets it at once when they have enough
//   POST /api/dashboard/guild/:guildId/invites/unreward  { role_id }           the role is no longer given for invites
//   POST /api/dashboard/guild/:guildId/invites/bonus     { member_id, amount }  bonus invites for a member (negative takes them away)
//   POST /api/dashboard/guild/:guildId/invites/reset     { member_id }          the counters of a member back to zero (Administrator)
//   POST /api/dashboard/guild/:guildId/invites/fake_days { days }               accounts younger than this are fake joins (0 to 365)
//   POST /api/dashboard/guild/:guildId/invites/settings  { fake_days?, quick_leave_minutes?, ignore_bots?, subtract_leaves? }  the four settings in one save
//        (fake_days 0 to 365, quick_leave_minutes 0 to 1440, the other two true or false); what is not sent stays as it is
// Access: the dashboard key and a `user_id` who manages the server (or a role with edit access to Statistics), like the other routes.
// Every answer is `{ ok, message, code? }`, the message in the language of the request.
const { PermissionFlagsBits } = require('discord.js');
const inviteTracking = require('../db/inviteTracking');
const { readSettingsPatch } = require('../db/inviteTrackingRules');
const { applyRewards } = require('../utils/inviteRewards');
const { ensureGuild } = require('../db/guilds');
const logger = require('../utils/logger');
const { t, tn, requestLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;
const ACTIONS = new Set(['reward', 'unreward', 'bonus', 'reset', 'fake_days', 'settings']);

/** Gives the roles of the rewards to everyone already counted, one after the other, without holding the answer. */
function applyToEveryone(guild) {
  (async () => {
    for (const inviterId of await inviteTracking.listInviterIds(guild.id)) await applyRewards(guild, inviterId);
  })().catch((error) => logger.warn({ guildId: guild.id, action: 'invite-rewards' }, `Invite rewards for everyone failed: ${error.message}`));
}

function registerInviteRoutes(app, { authorize, limiter, background = applyToEveryone }) {
  const middleware = limiter ? [limiter] : [];
  app.post('/api/dashboard/guild/:guildId/invites/:action', ...middleware, async (req, res) => {
    const action = String(req.params.action);
    if (!ACTIONS.has(action)) { res.status(404).json({ ok: false, error: 'unknown_action' }); return; }
    const access = await authorize(req, res, { page: 'stats', edit: true });
    if (!access) return;
    const { guild, member } = access;
    const lang = requestLanguage(req, guild.id);
    const fail = (status, code, key, vars) => res.status(status).json({ ok: false, code, message: t(lang, `web.api.invites.${key}`, vars) });
    const has = (flag) => Boolean(member?.permissions?.has(flag));
    const body = req.body ?? {};
    try {
      if (action === 'settings') {
        const { values, error } = readSettingsPatch({ fakeDays: body.fake_days, quickLeaveMinutes: body.quick_leave_minutes, ignoreBots: body.ignore_bots, subtractLeaves: body.subtract_leaves });
        if (error === 'fakeDays') { fail(400, 'bad_days', 'badDays'); return; }
        if (error === 'quickLeaveMinutes') { fail(400, 'bad_minutes', 'badMinutes'); return; }
        if (error) { fail(400, 'bad_flag', 'badFlag'); return; }
        if (!Object.keys(values).length) { fail(400, 'nothing', 'nothingToSave'); return; }
        await ensureGuild(guild.id);
        const settings = await inviteTracking.setSettings(guild.id, values);
        res.json({ ok: true, message: t(lang, 'web.api.invites.settingsSaved'), settings });
        return;
      }

      if (action === 'fake_days') {
        const days = Number(body.days);
        if (!Number.isInteger(days) || days < 0 || days > 365) { fail(400, 'bad_days', 'badDays'); return; }
        await ensureGuild(guild.id);
        await inviteTracking.setFakeDays(guild.id, days);
        res.json({ ok: true, message: days ? tn(lang, 'web.api.invites.fakeDays', days, { count: days }) : t(lang, 'web.api.invites.fakeDaysOff') });
        return;
      }

      if (action === 'reward' || action === 'unreward') {
        const roleId = String(body.role_id ?? '');
        const role = SNOWFLAKE.test(roleId) ? (guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null)) : null;
        if (action === 'unreward') {
          if (!SNOWFLAKE.test(roleId)) { fail(400, 'bad_role', 'pickRole'); return; }
          const removed = await inviteTracking.removeReward(guild.id, roleId);
          if (!removed) { fail(404, 'not_reward', 'notReward'); return; }
          res.json({ ok: true, message: t(lang, 'web.api.invites.removed', { role: role ? `@${role.name}` : roleId }) });
          return;
        }
        if (!role) { fail(400, 'bad_role', 'pickRole'); return; }
        const invites = Number(body.invites);
        if (!Number.isInteger(invites) || invites < 1 || invites > 100000) { fail(400, 'bad_invites', 'badInvites'); return; }
        // The same as the command: Petto can only give roles below its own, never @everyone or a role of an integration, and a member
        // who is not the owner can only use roles below their own highest one.
        const me = guild.members.me;
        if (role.managed || role.id === guild.id || !me || role.position >= me.roles.highest.position) { fail(400, 'cannot_give', 'cannotGive'); return; }
        if (member && member.id !== guild.ownerId && role.position >= member.roles.highest.position) { fail(403, 'above_yours', 'aboveYours'); return; }
        await ensureGuild(guild.id);
        await inviteTracking.addReward(guild.id, invites, role.id);
        background(guild);
        res.json({ ok: true, message: tn(lang, 'web.api.invites.added', invites, { count: invites, role: role.name }) });
        return;
      }

      const memberId = String(body.member_id ?? '');
      if (!SNOWFLAKE.test(memberId)) { fail(400, 'bad_member', 'pickMember'); return; }
      if (action === 'reset') {
        if (!has(PermissionFlagsBits.Administrator)) { fail(403, 'admin_only', 'adminOnly'); return; }
        await inviteTracking.resetUser(guild.id, memberId);
        await applyRewards(guild, memberId);
        res.json({ ok: true, message: t(lang, 'web.api.invites.reset') });
        return;
      }
      // bonus
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) { fail(400, 'bad_amount', 'badAmount'); return; }
      await ensureGuild(guild.id);
      const stats = await inviteTracking.addBonus(guild.id, memberId, amount);
      await applyRewards(guild, memberId);
      const total = stats.total;
      res.json({ ok: true, message: t(lang, amount > 0 ? 'web.api.invites.bonusAdded' : 'web.api.invites.bonusRemoved', { amount: Math.abs(amount), total }) });
    } catch (err) {
      logger.error(`Dashboard invites ${action} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, code: 'failed', message: t(lang, 'web.api.invites.failed') });
    }
  });
}

module.exports = { registerInviteRoutes };
