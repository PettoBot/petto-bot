const supabase = require('../db/supabase');
const config = require('../config');
const logger = require('../utils/logger');
const { forEachWithConcurrency, exclusiveTask } = require('../utils/concurrency');

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
let premiumGuildId = null;

function configuredRoleIds() {
  return Object.values(config.premiumRoleIds).filter(Boolean);
}

function roleIdForSlots(slots) {
  const count = Number(slots) || 0;
  if (count >= 5) return config.premiumRoleIds[5];
  if (count >= 3) return config.premiumRoleIds[3];
  if (count >= 1) return config.premiumRoleIds[1];
  return null;
}

function isActive(entitlement) {
  if (!entitlement || entitlement.status !== 'active') return false;
  if (!entitlement.current_period_end) return true;
  const expiry = new Date(entitlement.current_period_end).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

async function findPremiumGuild(client) {
  const roleIds = configuredRoleIds();
  if (!roleIds.length) return null;

  if (premiumGuildId) {
    const cached = client.guilds.cache.get(premiumGuildId);
    if (cached && roleIds.every((roleId) => cached.roles.cache.has(roleId))) return cached;
    premiumGuildId = null;
  }

  const configuredGuildIds = [...new Set([config.premiumGuildId, config.supportGuildId].filter(Boolean))];
  for (const guildId of configuredGuildIds) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    if (!roleIds.every((roleId) => guild.roles.cache.has(roleId))) await guild.roles.fetch().catch(() => null);
    if (roleIds.every((roleId) => guild.roles.cache.has(roleId))) {
      premiumGuildId = guild.id;
      return guild;
    }
  }

  for (const guild of client.guilds.cache.values()) {
    if (roleIds.every((roleId) => guild.roles.cache.has(roleId))) {
      premiumGuildId = guild.id;
      return guild;
    }
  }

  for (const guild of client.guilds.cache.values()) {
    await guild.roles.fetch().catch(() => null);
    if (roleIds.every((roleId) => guild.roles.cache.has(roleId))) {
      premiumGuildId = guild.id;
      return guild;
    }
  }
  return null;
}

async function activeSlotsForUser(userId) {
  const { data, error } = await supabase
    .from('premium_entitlements')
    .select('status,slot_limit,current_period_end,updated_at')
    .eq('user_id', String(userId))
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return (data ?? [])
    .filter(isActive)
    .reduce((highest, entitlement) => Math.max(highest, Number(entitlement.slot_limit) || 0), 0);
}

async function syncMemberRoles(member, slots) {
  const allRoleIds = configuredRoleIds();
  const desiredRoleId = roleIdForSlots(slots);
  const toRemove = allRoleIds.filter((roleId) => roleId !== desiredRoleId && member.roles.cache.has(roleId));

  if (toRemove.length) {
    await member.roles.remove(toRemove, 'Petto Premium plan changed or ended');
  }
  if (desiredRoleId && !member.roles.cache.has(desiredRoleId)) {
    await member.roles.add(desiredRoleId, `Petto Premium ${slots}-slot entitlement`);
  }
}

async function syncPremiumRoleForUser(client, userId) {
  const guild = await findPremiumGuild(client);
  if (!guild) {
    logger.warn('Premium role sync skipped: the configured Premium roles were not found together in any server.');
    return false;
  }

  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return false;
  const slots = await activeSlotsForUser(userId);
  await syncMemberRoles(member, slots);
  return true;
}

async function syncAllPremiumRoles(client) {
  const guild = await findPremiumGuild(client);
  if (!guild) {
    logger.warn('Premium role sync skipped: the configured Premium roles were not found together in any server.');
    return;
  }

  const entitlements = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('premium_entitlements')
      .select('id,user_id,status,slot_limit,current_period_end,updated_at')
      .not('user_id', 'is', null)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    entitlements.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  const slotsByUser = new Map();
  for (const entitlement of entitlements) {
    const userId = String(entitlement.user_id);
    const current = slotsByUser.get(userId) ?? 0;
    const slots = isActive(entitlement) ? Number(entitlement.slot_limit) || 0 : 0;
    slotsByUser.set(userId, Math.max(current, slots));
  }

  await forEachWithConcurrency(slotsByUser, async ([userId, slots]) => {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    await syncMemberRoles(member, slots).catch((error) => {
      logger.warn(`Premium role sync failed for ${userId}:`, error.message);
    });
  }, config.jobConcurrency);
}

function startPremiumRoleJob(client) {
  const run = exclusiveTask(() => syncAllPremiumRoles(client));
  const runLogged = () => run().catch((error) => logger.error('Premium role sync job failed:', error));
  const initial = setTimeout(runLogged, 5_000);
  const interval = setInterval(runLogged, SYNC_INTERVAL_MS);
  initial.unref?.();
  interval.unref?.();
}

module.exports = { startPremiumRoleJob, syncAllPremiumRoles, syncPremiumRoleForUser, roleIdForSlots };
