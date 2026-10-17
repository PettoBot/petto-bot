const { startLockdown } = require('./lockdown');
const { getActive } = require('../db/lockdown');
const logger = require('./logger');
const { t, guildLanguage } = require('../i18n');

/**
 * Panic mode: when several protections act in a short time (or Anti Raid sees a raid), the server is locked down at once
 * (channels closed, invites deleted and paused) and opens again by itself after a while. It is off until the server turns it
 * on; the lockdown that starts is a normal one, so `/lockdown end` or the dashboard end it earlier.
 */
const DEFAULTS = { threshold: 2, windowMinutes: 10, lockdownMinutes: 30 };
const incidentsByGuild = new Map(); // guildId -> [timestamp]
const startingByGuild = new Map(); // guildId -> until (a panic already starting or started)

function panicSettings(config) {
  return {
    enabled: Boolean(config?.panic_enabled),
    threshold: Math.max(1, Number(config?.panic_threshold) || DEFAULTS.threshold),
    windowMinutes: Math.max(1, Number(config?.panic_window_minutes) || DEFAULTS.windowMinutes),
    lockdownMinutes: Math.max(1, Number(config?.panic_lockdown_minutes) || DEFAULTS.lockdownMinutes),
    onRaid: config?.panic_on_raid !== false,
  };
}

/** Starts the panic lockdown. Answers true when it started now, false when it was already on or could not start. */
async function startPanic(client, guild, config, reasonKey, vars = {}) {
  const settings = panicSettings(config);
  const now = Date.now();
  if ((startingByGuild.get(guild.id) ?? 0) > now) return false;
  startingByGuild.set(guild.id, now + settings.lockdownMinutes * 60_000);
  try {
    if (await getActive(guild.id)) return false;
    const lang = await guildLanguage(guild.id);
    await startLockdown(guild, { startedBy: client.user.id, reason: t(lang, reasonKey, vars), minutes: settings.lockdownMinutes, pauseInvites: true });
    return true;
  } catch (err) {
    startingByGuild.delete(guild.id);
    if (!err.userFacing) logger.error(`Anti-nuke panic lockdown failed in ${guild.id}:`, err);
    return false;
  }
}

/** One protection acted. Answers true when this incident started the panic lockdown. */
async function noteIncident(client, guild, config) {
  const settings = panicSettings(config);
  if (!settings.enabled) return false;
  const now = Date.now();
  const recent = (incidentsByGuild.get(guild.id) ?? []).filter((ts) => now - ts < settings.windowMinutes * 60_000);
  recent.push(now);
  incidentsByGuild.set(guild.id, recent);
  if (recent.length < settings.threshold) return false;
  return startPanic(client, guild, config, 'security.antinuke.panic.reasonIncidents', { count: recent.length, minutes: settings.windowMinutes });
}

/** Anti Raid saw a raid: with panic mode on (and its raid switch), the server is locked down the same way. */
async function noteRaid(client, guild, config, count) {
  const settings = panicSettings(config);
  if (!settings.enabled || !settings.onRaid) return false;
  return startPanic(client, guild, config, 'security.antinuke.panic.reasonRaid', { count });
}

function resetPanic() {
  incidentsByGuild.clear();
  startingByGuild.clear();
}

module.exports = { panicSettings, noteIncident, noteRaid, resetPanic };
