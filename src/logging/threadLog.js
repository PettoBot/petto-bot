// Threads created, changed and deleted. The threads Petto itself starts (auto threads, tickets) are left out.
const { sendLog, getAvatar, fetchMod, AuditLogEvent } = require('./engine');

const THREAD_TYPES = { 10: 'Announcement thread', 11: 'Public thread', 12: 'Private thread' };
const ARCHIVE = { 60: '1 hour', 1440: '1 day', 4320: '3 days', 10080: '1 week' };

const ownThread = (thread, client) => thread.ownerId && thread.ownerId === client.user.id;

async function handleThreadCreate(thread, newlyCreated, client) {
  if (!newlyCreated || !thread.guild || ownThread(thread, client)) return;
  const owner = thread.ownerId ? await thread.guild.members.fetch(thread.ownerId).catch(() => null) : null;
  const fields = [
    { name: 'Type', value: THREAD_TYPES[thread.type] ?? 'Thread', inline: true },
    { name: 'Channel', value: thread.parentId ? `<#${thread.parentId}>` : 'Unknown', inline: true },
    { name: 'Auto-archive', value: ARCHIVE[thread.autoArchiveDuration] ?? `${thread.autoArchiveDuration ?? '?'} min`, inline: true },
  ];
  if (thread.ownerId) fields.push({ name: 'Started by', value: `<@${thread.ownerId}>`, inline: true });
  await sendLog(client, thread.guild.id, 'threads', {
    author: { name: 'Thread Created', icon_url: owner ? getAvatar(owner.user) ?? undefined : undefined },
    description: `<#${thread.id}> (\`${thread.name}\`) was created`,
    fields,
    footer: { text: `Thread ID: ${thread.id}` },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [thread.id, thread.parentId] });
}

async function handleThreadDelete(thread, client) {
  if (!thread.guild || ownThread(thread, client)) return;
  const mod = await fetchMod(thread.guild, AuditLogEvent.ThreadDelete, thread.id);
  const fields = [{ name: 'Type', value: THREAD_TYPES[thread.type] ?? 'Thread', inline: true }];
  if (thread.parentId) fields.push({ name: 'Channel', value: `<#${thread.parentId}>`, inline: true });
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  await sendLog(client, thread.guild.id, 'threads', {
    author: { name: 'Thread Deleted' },
    description: `\`${thread.name}\` was deleted`,
    fields,
    footer: { text: `Thread ID: ${thread.id}` },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [thread.id, thread.parentId] });
}

async function handleThreadUpdate(oldThread, newThread, client) {
  if (!newThread.guild || ownThread(newThread, client)) return;
  const fields = [];
  if (oldThread.name !== newThread.name) fields.push({ name: 'Name', value: `\`${oldThread.name}\` -> \`${newThread.name}\``, inline: false });
  if (oldThread.locked !== newThread.locked) fields.push({ name: 'Locked', value: `\`${Boolean(oldThread.locked)}\` -> \`${Boolean(newThread.locked)}\``, inline: true });
  if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) fields.push({ name: 'Auto-archive', value: `${ARCHIVE[oldThread.autoArchiveDuration] ?? oldThread.autoArchiveDuration} -> ${ARCHIVE[newThread.autoArchiveDuration] ?? newThread.autoArchiveDuration}`, inline: true });
  if ((oldThread.rateLimitPerUser ?? 0) !== (newThread.rateLimitPerUser ?? 0)) fields.push({ name: 'Slowmode', value: `${oldThread.rateLimitPerUser ?? 0}s -> ${newThread.rateLimitPerUser ?? 0}s`, inline: true });
  const archivedChanged = oldThread.archived !== newThread.archived;
  if (!fields.length && !archivedChanged) return;

  const mod = await fetchMod(newThread.guild, AuditLogEvent.ThreadUpdate, newThread.id);
  // A thread that archives itself after a quiet time happens all day, so archiving is only told when a person did it.
  if (archivedChanged && mod) fields.unshift({ name: 'State', value: newThread.archived ? 'Archived' : 'Unarchived', inline: true });
  if (!fields.length) return;
  if (mod) fields.push({ name: 'By', value: mod, inline: true });
  await sendLog(client, newThread.guild.id, 'threads', {
    author: { name: 'Thread Updated' },
    description: `<#${newThread.id}> was updated`,
    fields,
    footer: { text: `Thread ID: ${newThread.id}` },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [newThread.id, newThread.parentId] });
}

module.exports = { handleThreadCreate, handleThreadDelete, handleThreadUpdate };
