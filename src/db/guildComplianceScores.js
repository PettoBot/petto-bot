const database = require('./database');
const { ensureGuild } = require('./guilds');

function normalizeRow(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    score: Number(row.score ?? 0),
    confidence: row.confidence ?? 'low',
    actionable: Boolean(row.actionable),
    labels: Array.isArray(row.labels) ? row.labels : [],
    families: Array.isArray(row.families) ? row.families : [],
    firstDetectedAt: row.first_detected_at ?? null,
    lastDetectedAt: row.last_detected_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function getGuildComplianceScore(guildId) {
  const { data, error } = await database
    .from('guild_compliance_scores')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) throw error;
  return normalizeRow(data);
}

/**
 * Persists only actionable findings. Generic words such as "shop" or "store"
 * never create a score row by themselves, so a restart cannot turn a weak
 * metadata hint into a lasting compliance score.
 */
async function recordGuildComplianceSignal(guildId, { score, confidence, labels, families }) {
  await ensureGuild(guildId);
  const previous = await getGuildComplianceScore(guildId);
  const now = new Date().toISOString();
  const safeScore = Math.max(0, Math.min(16, Number(score) || 0));

  const { data, error } = await database
    .from('guild_compliance_scores')
    .upsert({
      guild_id: guildId,
      score: safeScore,
      confidence: String(confidence || 'low'),
      actionable: true,
      labels: JSON.stringify([...new Set((labels ?? []).map(String))].slice(0, 12)),
      families: JSON.stringify([...new Set((families ?? []).map(String))].slice(0, 8)),
      first_detected_at: previous?.firstDetectedAt ?? now,
      last_detected_at: now,
      updated_at: now,
    }, { onConflict: 'guild_id' })
    .select('*')
    .single();

  if (error) throw error;
  return normalizeRow(data);
}

module.exports = { getGuildComplianceScore, recordGuildComplianceSignal };
