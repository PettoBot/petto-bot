// Live counters from the dashboard. The dashboard edits the saved settings straight in the database; these routes need the bot:
//   POST /api/dashboard/guild/:guildId/counters/preview { } -> { ok, values: { <type>: value }, presences, counters: [...], limits }
//        the value of every type now and, for each counter, the name it wants, the name it has, its problem and its next rename
//   POST /api/dashboard/guild/:guildId/counters/create  { type, template, format, kind, category_id, channel_id, role_id, goal, timezone }
//   POST /api/dashboard/guild/:guildId/counters/setup   { preset?, goal?, timezone? }  a pack (basic, boosts, online, goal, clock) in its category
//   POST /api/dashboard/guild/:guildId/counters/refresh { channel_id? }  reads the settings again and renames what the budget allows
//   POST /api/dashboard/guild/:guildId/counters/delete  { channel_id, delete_channel }
// The same access as the other dashboard routes: the dashboard key and a `user_id` who can manage the server, or whose roles open the
// Counters page through "Dashboard access" (checked again by the bot, see dashboardRoleAccess.js; preview only needs to look).
const countersDb = require('../db/counters');
const { OPTIONS, recentRenames, nextRenameAt } = require('../utils/counterNames');
const { countGuild } = require('../utils/counterValues');
const { createCounter, setupPreset, counterLimits, previewName } = require('../utils/counterSetup');
const logger = require('../utils/logger');
const { t, requestLanguage } = require('../i18n');

const SNOWFLAKE = /^\d{15,25}$/;
const job = () => require('../jobs/counterJob');
const idOrNull = (value) => (SNOWFLAKE.test(String(value ?? '')) ? String(value) : null);

function createMessage(result, lang) {
  if (result.error === 'limitFree') return t(lang, 'counters.create.limitFree', { count: result.count, premium: result.premium });
  if (result.error === 'limit') return t(lang, 'counters.create.limit', { count: result.count });
  if (result.error === 'unknownType') return t(lang, 'counters.create.unknownType', { type: result.type || '?', prefix: '!' });
  if (result.error === 'needRole') return t(lang, 'counters.create.needRole', { prefix: '!' });
  if (result.error === 'badTimezone') return t(lang, 'counters.create.badTimezone', { zone: result.zone });
  if (result.error === 'notCategory') return t(lang, 'counters.parentNotCategory');
  if (result.error === 'already') return t(lang, 'counters.setup.already', { count: result.count, prefix: '!' });
  if (result.error === 'unknownPreset') return t(lang, 'counters.preset.unknown', { preset: result.preset, presets: result.presets.join(', '), prefix: '!' });
  if (result.error === 'presetHave') return t(lang, 'counters.preset.have', { preset: result.preset, prefix: '!' });
  if (result.error === 'alreadyCounter') return t(lang, 'counters.create.alreadyCounter', { channel: `#${result.channel?.name ?? ''}`, prefix: '!' });
  if (result.error === 'permission') return t(lang, 'counters.add.failedPermission', { permission: t(lang, 'core.perm.ManageChannels') });
  return t(lang, 'counters.add.failed', { error: result.detail || '?' });
}

function registerCounterRoutes(app, { authorize, limiter }) {
  const middleware = limiter ? [limiter] : [];
  const route = (name, handler) => app.post(`/api/dashboard/guild/:guildId/counters/${name}`, ...middleware, async (req, res) => {
    const access = await authorize(req, res, { page: 'counters', edit: name !== 'preview' });
    if (!access) return;
    const lang = requestLanguage(req, access.guild.id);
    try {
      await handler(req, res, access, lang);
    } catch (err) {
      logger.error(`Dashboard counters ${name} failed for guild ${req.params.guildId}:`, err);
      res.status(500).json({ ok: false, message: t(lang, 'web.api.forms.failed') });
    }
  });

  route('preview', async (req, res, { guild }, lang) => {
    const values = {};
    for (const option of OPTIONS) if (option !== 'role_members') values[option] = countGuild(guild, option, lang, {});
    const roles = {};
    const rows = await countersDb.list(guild.id);
    const now = Date.now();
    const counters = rows.map((row) => {
      if (row.target_id) roles[row.target_id] = countGuild(guild, 'role_members', lang, row);
      const channel = guild.channels.cache.get(row.channel_id);
      const times = recentRenames(row.rename_times, now);
      return {
        channel_id: row.channel_id, name: previewName(guild, row, lang), current_name: channel?.name ?? null, exists: Boolean(channel),
        problem: row.problem ?? null, enabled: row.enabled !== false, renames_left: Math.max(0, 2 - times.length),
        next_rename_at: job().pendingRenameAt(row.channel_id) ?? (times.length >= 2 ? nextRenameAt(times, now) : null),
      };
    });
    res.set('Cache-Control', 'no-store'); // i18n-ignore: HTTP header
    res.json({ ok: true, values, roles, presences: Boolean(guild.presences?.cache?.size), counters, limits: await counterLimits(guild.id) });
  });

  route('create', async (req, res, { guild, userId, member }, lang) => {
    const body = req.body ?? {};
    const result = await createCounter(guild, {
      type: body.type, template: body.template, format: body.format, kind: body.kind, categoryId: idOrNull(body.category_id), channelId: idOrNull(body.channel_id),
      roleId: idOrNull(body.role_id), goal: body.goal, timezone: body.timezone ? String(body.timezone).slice(0, 64) : null, prefix: body.prefix, suffix: body.suffix,
      createdBy: userId, reason: t(lang, 'counters.add.reason', { user: member?.user?.tag ?? member?.user?.username ?? userId }),
    }, lang);
    if (!result.ok) { res.status(400).json({ ok: false, message: createMessage(result, lang) }); return; }
    job().refreshGuildCounters(guild.client, guild.id, { reload: true }).catch(() => {});
    res.json({ ok: true, channel_id: result.channel.id, name: result.name, message: t(lang, result.existing ? 'counters.create.existing' : 'counters.create.done', { emoji: '', channel: `#${result.channel.name}`, name: result.name }).trim() });
  });

  route('setup', async (req, res, { guild, userId, member }, lang) => {
    const body = req.body ?? {};
    const result = await setupPreset(guild, {
      createdBy: userId, reason: t(lang, 'counters.setup.reason', { user: member?.user?.tag ?? userId }),
      preset: typeof body.preset === 'string' ? body.preset.slice(0, 30) : null, goal: body.goal ?? null, timezone: body.timezone ? String(body.timezone).slice(0, 64) : null,
    }, lang);
    if (!result.ok) { res.status(400).json({ ok: false, message: createMessage(result, lang) }); return; }
    job().refreshGuildCounters(guild.client, guild.id, { reload: true }).catch(() => {});
    const done = t(lang, 'counters.setup.done', { emoji: '', category: result.category.name, channels: result.made.map((m) => `#${m.channel.name}`).join(', ') }).trim();
    res.json({ ok: true, preset: result.preset, message: result.skipped ? `${done} ${t(lang, 'counters.preset.skipped', { count: result.skipped })}` : done });
  });

  route('refresh', async (req, res, { guild }, lang) => {
    const results = await job().refreshGuildCounters(guild.client, guild.id, { reload: true, channelId: idOrNull(req.body?.channel_id) });
    const count = (what) => results.filter((r) => r.result === what).length;
    res.json({ ok: true, results, message: results.length ? t(lang, 'counters.refresh.done', { emoji: '', renamed: count('renamed'), waiting: count('waiting'), same: count('same') }).trim() : t(lang, 'counters.refresh.none') });
  });

  route('delete', async (req, res, { guild, userId }, lang) => {
    const channelId = idOrNull(req.body?.channel_id);
    const removed = channelId ? await countersDb.remove(guild.id, channelId) : false;
    if (!removed) { res.status(404).json({ ok: false, message: t(lang, 'counters.notCounter') }); return; }
    const channel = guild.channels.cache.get(channelId);
    let deleted = false;
    if (req.body?.delete_channel && channel) deleted = await channel.delete(t(lang, 'counters.add.reason', { user: userId })).then(() => true).catch(() => false);
    job().refreshGuildCounters(guild.client, guild.id, { reload: true }).catch(() => {});
    res.json({ ok: true, deleted, message: t(lang, deleted ? 'counters.delete.done' : 'counters.delete.kept', { emoji: '', channel: `#${channel?.name ?? channelId}` }).trim() });
  });
}

module.exports = { registerCounterRoutes };
