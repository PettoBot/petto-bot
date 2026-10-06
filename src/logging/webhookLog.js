// Webhook created, changed and deleted. Discord's WebhooksUpdate event only says which channel changed, so what
// happened and who did it come from the audit log.
const { sendLog, AuditLogEvent } = require('./engine');

const KINDS = [
  { type: AuditLogEvent.WebhookCreate, title: 'Webhook Created', verb: 'was created' },
  { type: AuditLogEvent.WebhookUpdate, title: 'Webhook Updated', verb: 'was updated' },
  { type: AuditLogEvent.WebhookDelete, title: 'Webhook Deleted', verb: 'was deleted' },
];
const MAX_AGE_MS = 15_000;
// The event fires once per change in a channel, and anti-nuke also reads it, so each audit entry is told once.
const told = new Map();

const change = (entry, key) => (entry.changes ?? []).find((item) => item.key === key);

function describe(entry, kind, channelId) {
  const name = change(entry, 'name')?.new ?? change(entry, 'name')?.old ?? entry.target?.name ?? 'Unknown';
  const where = change(entry, 'channel_id')?.new ?? change(entry, 'channel_id')?.old ?? channelId;
  const fields = [];
  if (where) fields.push({ name: 'Channel', value: `<#${where}>`, inline: true });
  if (entry.executor) fields.push({ name: 'By', value: `<@${entry.executor.id}>`, inline: true });
  const type = entry.target?.type ?? change(entry, 'type')?.new ?? change(entry, 'type')?.old;
  if (type === 2) fields.push({ name: 'Kind', value: 'Channel follower', inline: true });
  if (kind.type === AuditLogEvent.WebhookUpdate) {
    const before = change(entry, 'name');
    if (before) fields.push({ name: 'Name', value: `\`${before.old ?? '*None*'}\` -> \`${before.new ?? '*None*'}\``, inline: false });
    const moved = change(entry, 'channel_id');
    if (moved) fields.push({ name: 'Moved', value: `${moved.old ? `<#${moved.old}>` : '*None*'} -> ${moved.new ? `<#${moved.new}>` : '*None*'}`, inline: false });
    if (change(entry, 'avatar_hash')) fields.push({ name: 'Avatar', value: 'The avatar was changed', inline: false });
  }
  return {
    author: { name: kind.title },
    description: `Webhook \`${name}\` ${kind.verb}${where ? ` in <#${where}>` : ''}`,
    fields,
    footer: { text: `Webhook ID: ${entry.targetId ?? 'unknown'}` },
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
  for (const { entry, kind } of found) {
    told.set(entry.id, now);
    await sendLog(client, guild.id, 'webhooks', describe(entry, kind, channel.id));
  }
}

module.exports = { handleWebhooksUpdate };
