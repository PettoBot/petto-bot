const { ensureGuild, updateGuild } = require('./guilds');

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function normalize(row) {
  return {
    ignored: Boolean(row?.compliance_ignored),
    ignoredBy: row?.compliance_ignored_by ?? null,
    ignoredAt: row?.compliance_ignored_at ?? null,
    reason: row?.compliance_ignore_reason ?? null,
  };
}

async function getGuildComplianceSettings(guildId, { refresh = false } = {}) {
  const key = String(guildId);
  const now = Date.now();
  const cached = cache.get(key);

  if (!refresh && cached && cached.expiresAt > now) return cached.value;

  const row = await ensureGuild(key);
  const value = normalize(row);
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function isGuildComplianceIgnored(guildId) {
  return (await getGuildComplianceSettings(guildId)).ignored;
}

async function setGuildComplianceIgnored(guildId, ignored, { userId = null, reason = null } = {}) {
  const key = String(guildId);
  await ensureGuild(key);

  const row = await updateGuild(key, ignored
    ? {
        compliance_ignored: true,
        compliance_ignored_by: userId ? String(userId) : null,
        compliance_ignored_at: new Date().toISOString(),
        compliance_ignore_reason: reason ? String(reason).slice(0, 500) : null,
      }
    : {
        compliance_ignored: false,
        compliance_ignored_by: null,
        compliance_ignored_at: null,
        compliance_ignore_reason: null,
      });

  const value = normalize(row);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function invalidateGuildComplianceSettings(guildId) {
  cache.delete(String(guildId));
}

module.exports = {
  getGuildComplianceSettings,
  invalidateGuildComplianceSettings,
  isGuildComplianceIgnored,
  setGuildComplianceIgnored,
};
