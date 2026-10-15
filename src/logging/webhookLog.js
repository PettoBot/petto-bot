// Webhook created, changed and deleted. Discord's WebhooksUpdate event only says which channel changed, so what
// happened and who did it come from the audit log.
const { sendLog, AuditLogEvent } = require('./engine');
const { t, guildLanguage, currentLanguage } = require('../i18n');

const KINDS = [
  { type: AuditLogEvent.WebhookCreate, what: 'created' },
  { type: AuditLogEvent.WebhookUpdate, what: 'updated' },
  { type: AuditLogEvent.WebhookDelete, what: 'deleted' },
];
const MAX_AGE_MS = 15_000;
// The event fires once per change in a channel, and anti-nuke also reads it, so each audit entry is told once.
const told = new Map();

const change = (entry, key) => (entry.changes ?? []).find((item) => item.key === key);

function describe(entry, kind, channelId, lang = currentLanguage()) {
  const none = t(lang, 'logs.noneItalic');
  const name = change(entry, 'name')?.new ?? change(entry, 'name')?.old ?? entry.target?.name ?? t(lang, 'logs.unknown');
  const where = change(entry, 'channel_id')?.new ?? change(entry, 'channel_id')?.old ?? channelId;
  const fields = [];
  if (where) fields.push({ name: t(lang, 'logs.field.channel'), value: `<#${where}>`, inline: true });
  if (entry.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${entry.executor.id}>`, inline: true });
  const type = entry.target?.type ?? change(entry, 'type')?.new ?? change(entry, 'type')?.old;
  if (type === 2) fields.push({ name: t(lang, 'logs.field.kind'), value: t(lang, 'logs.webhook.follower'), inline: true });
  if (kind.type === AuditLogEvent.WebhookUpdate) {
    const before = change(entry, 'name');
    if (before) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${before.old ?? none}\` -> \`${before.new ?? none}\``, inline: false });
    const moved = change(entry, 'channel_id');
    if (moved) fields.push({ name: t(lang, 'logs.webhook.moved'), value: `${moved.old ? `<#${moved.old}>` : none} -> ${moved.new ? `<#${moved.new}>` : none}`, inline: false });
    if (change(entry, 'avatar_hash')) fields.push({ name: t(lang, 'logs.webhook.avatar'), value: t(lang, 'logs.webhook.avatarChanged'), inline: false });
  }
  return {
    author: { name: t(lang, `logs.webhook.${kind.what}.title`) },
    description: where
      ? t(lang, `logs.webhook.${kind.what}.descriptionIn`, { name, channel: `<#${where}>` })
      : t(lang, `logs.webhook.${kind.what}.description`, { name }),
    fields,
    footer: { text: t(lang, 'logs.webhook.footer', { id: entry.targetId ?? t(lang, 'logs.unknownId') }) },
    timestamp: new Date(entry.createdTimestamp ?? Date.now()).toISOString(),
  };
}

async function handleWebhooksUpdate(channel, client) {
  const guild = channel.guild;
  if (!guild) return;
  const now = Date.now();
  for (const [id, at] of told) if (now - at > 60_000) told.delete(id);

  const found = [];
  for (const kind of KINDS) {
    let logs;
    try {
      logs = await guild.fetchAuditLogs({ type: kind.type, limit: 5 });
    } catch {
      return; // Without View Audit Log there is nothing to tell apart.
    }
    for (const entry of logs.entries.values()) {
      if (now - entry.createdTimestamp > MAX_AGE_MS || told.has(entry.id)) continue;
      // The webhooks Petto makes for its own log channels are not news.
      if (entry.executor?.id === client.user.id) { told.set(entry.id, now); continue; }
      const channels = [change(entry, 'channel_id')?.new, change(entry, 'channel_id')?.old].filter(Boolean);
      if (channels.length && !channels.includes(channel.id)) continue;
      found.push({ entry, kind });
    }
  }

  found.sort((a, b) => a.entry.createdTimestamp - b.entry.createdTimestamp);
  const lang = found.length ? await guildLanguage(guild.id) : null;
  for (const { entry, kind } of found) {
    told.set(entry.id, now);
    await sendLog(client, guild.id, 'webhooks', describe(entry, kind, channel.id, lang));
  }
}

module.exports = { handleWebhooksUpdate };
