// Shared validation and mutation helpers for booster-role commands.
const db = require('../db/boosterRole');
const { t, tn, currentLanguage } = require('../i18n');

function parseHex(str) {
  if (!str) return null;
  const hex = str.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return { hex: `#${hex.toUpperCase()}`, int: parseInt(hex, 16) };
}

function randomColorInt() {
  return Math.floor(Math.random() * 0xffffff);
}

function filterCheck(name, words) {
  const lower = name.toLowerCase();
  return (words ?? []).some((w) => lower.includes(w.toLowerCase()));
}

function resolveIconInput(input, lang = currentLanguage()) {
  if (!input) return { error: t(lang, 'utility.boosterrole.icon.missing') };
  if (/^<a:\w+:\d+>$/.test(input)) return { error: t(lang, 'utility.boosterrole.icon.animated') };

  const emojiMatch = input.match(/^<:[\w~]+:(\d+)>$/);
  if (emojiMatch) return { url: `https://cdn.discordapp.com/emojis/${emojiMatch[1]}.png` };
  if (input.startsWith('http')) return { url: input };
  if (/^\d{15,25}$/.test(input)) return { url: `https://media.discordapp.net/stickers/${input}.png` };

  return { error: t(lang, 'utility.boosterrole.icon.invalid') };
}

/** Returns remaining ms on a cooldown (0 if elapsed, not set, or the cooldown itself is disabled). */
function getRemainingCooldown(cooldownAt, cooldownMs) {
  if (!cooldownMs || !cooldownAt) return 0;
  const elapsed = Date.now() - new Date(cooldownAt).getTime();
  return elapsed >= cooldownMs ? 0 : cooldownMs - elapsed;
}

function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
// auto-managed "Server Booster" tag role if no base is set) and above every
// other existing booster role, newest on top.
async function getTargetPosition(guild, config) {
  let basePos = 1;
  if (config.base_role_id) {
    const base = guild.roles.cache.get(config.base_role_id);
    if (base) basePos = base.position + 1;
  } else {
    const boostRole = guild.roles.cache.find((r) => r.tags?.premiumSubscriberRole);
    if (boostRole) basePos = boostRole.position + 1;
  }

  const existing = await db.listBoosterRoles(guild.id);
  const existingIds = new Set(existing.map((br) => br.role_id));
  let maxPos = basePos - 1;
  for (const role of guild.roles.cache.values()) {
    if (existingIds.has(role.id) && role.position > maxPos) maxPos = role.position;
  }
  return maxPos + 1;
}

/**
 * Creates or updates a member's booster role. `bypassLimit` skips the
 * per-user role_limit check (used by admin's direct `set`, which is allowed
 * to act regardless of the member's own boost status/limit). `lang` is the
 * language of the errors and of the audit log reasons.
 */
async function applyRole({ guild, member, colorInt, color2Int, name, bypassLimit = false, lang = currentLanguage() }) {
  const config = await db.ensureConfig(guild.id);

  if (name && filterCheck(name, config.filtered_words)) {
    return { error: t(lang, 'utility.boosterrole.filteredRoleName') };
  }

  const existing = await db.getBoosterRole(guild.id, member.id);

  if (existing) {
    const role = guild.roles.cache.get(existing.role_id);
    if (role) {
      const updates = {};
      if (colorInt !== undefined) updates.colors = { primaryColor: colorInt, secondaryColor: color2Int ?? undefined };
      if (name !== undefined) updates.name = name;
      if (Object.keys(updates).length) {
        try {
          await role.edit(updates);
        } catch (err) {
          return { error: err.message };
        }
      }
      return { role, boosterRole: existing, updated: true };
    }
  }

  if (!bypassLimit && config.role_limit > 0) {
    const count = await db.countBoosterRoles(guild.id, member.id);
    if (count >= config.role_limit) return { error: tn(lang, 'utility.boosterrole.limitReached', config.role_limit, { count: config.role_limit }) };
  }

  const position = await getTargetPosition(guild, config);
  const roleData = { name: name || member.displayName, reason: t(lang, 'utility.boosterrole.audit.created', { user: member.user.tag }) };
  if (colorInt !== undefined) roleData.colors = { primaryColor: colorInt, secondaryColor: color2Int ?? undefined };

  let role;
  try {
    role = await guild.roles.create(roleData);
    await role.setPosition(position).catch(() => {});
    await member.roles.add(role);
  } catch (err) {
    if (role) await role.delete(t(lang, 'utility.boosterrole.audit.failed')).catch(() => {});
    return { error: err.message };
  }

  const boosterRole = await db.upsertBoosterRole(guild.id, member.id, { role_id: role.id });
  return { role, boosterRole, updated: false };
}

module.exports = { parseHex, randomColorInt, filterCheck, resolveIconInput, getRemainingCooldown, formatDuration, getTargetPosition, applyRole };
