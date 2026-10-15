// Threads created, changed and deleted. The threads Petto itself starts (auto threads, tickets) are left out.
const { sendLog, getAvatar, fetchMod, AuditLogEvent } = require('./engine');

const { t, guildLanguage } = require('../i18n');

const THREAD_TYPES = { 10: 'announcement', 11: 'public', 12: 'private' };
const ARCHIVE = { 60: 'hour', 1440: 'day', 4320: 'threeDays', 10080: 'week' };

const threadType = (type, lang) => t(lang, `logs.thread.type.${THREAD_TYPES[type] ?? 'thread'}`);
const archiveName = (minutes, lang) => (ARCHIVE[minutes] ? t(lang, `logs.thread.archive.${ARCHIVE[minutes]}`) : null);

const ownThread = (thread, client) => thread.ownerId && thread.ownerId === client.user.id;

async function handleThreadCreate(thread, newlyCreated, client) {
  if (!newlyCreated || !thread.guild || ownThread(thread, client)) return;
  const lang = await guildLanguage(thread.guild.id);
  const owner = thread.ownerId ? await thread.guild.members.fetch(thread.ownerId).catch(() => null) : null;
  const fields = [
    { name: t(lang, 'logs.field.type'), value: threadType(thread.type, lang), inline: true },
    { name: t(lang, 'logs.field.channel'), value: thread.parentId ? `<#${thread.parentId}>` : t(lang, 'logs.unknown'), inline: true },
    { name: t(lang, 'logs.thread.autoArchive'), value: archiveName(thread.autoArchiveDuration, lang) ?? `${thread.autoArchiveDuration ?? '?'} min`, inline: true },
  ];
  if (thread.ownerId) fields.push({ name: t(lang, 'logs.thread.startedBy'), value: `<@${thread.ownerId}>`, inline: true });
  await sendLog(client, thread.guild.id, 'threads', {
    author: { name: t(lang, 'logs.thread.created.title'), icon_url: owner ? getAvatar(owner.user) ?? undefined : undefined },
    description: t(lang, 'logs.thread.created.description', { thread: `<#${thread.id}>`, name: thread.name }),
    fields,
    footer: { text: t(lang, 'logs.thread.footer', { id: thread.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [thread.id, thread.parentId] });
}

async function handleThreadDelete(thread, client) {
  if (!thread.guild || ownThread(thread, client)) return;
  const lang = await guildLanguage(thread.guild.id);
  const mod = await fetchMod(thread.guild, AuditLogEvent.ThreadDelete, thread.id);
  const fields = [{ name: t(lang, 'logs.field.type'), value: threadType(thread.type, lang), inline: true }];
  if (thread.parentId) fields.push({ name: t(lang, 'logs.field.channel'), value: `<#${thread.parentId}>`, inline: true });
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  await sendLog(client, thread.guild.id, 'threads', {
    author: { name: t(lang, 'logs.thread.deleted.title') },
    description: t(lang, 'logs.thread.deleted.description', { name: thread.name }),
    fields,
    footer: { text: t(lang, 'logs.thread.footer', { id: thread.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [thread.id, thread.parentId] });
}

async function handleThreadUpdate(oldThread, newThread, client) {
  if (!newThread.guild || ownThread(newThread, client)) return;
  const lang = await guildLanguage(newThread.guild.id);
  const bool = (value) => `\`${t(lang, value ? 'logs.true' : 'logs.false')}\``;
  const fields = [];
  if (oldThread.name !== newThread.name) fields.push({ name: t(lang, 'logs.field.name'), value: `\`${oldThread.name}\` -> \`${newThread.name}\``, inline: false });
  if (oldThread.locked !== newThread.locked) fields.push({ name: t(lang, 'logs.thread.locked'), value: `${bool(Boolean(oldThread.locked))} -> ${bool(Boolean(newThread.locked))}`, inline: true });
  if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) fields.push({ name: t(lang, 'logs.thread.autoArchive'), value: `${archiveName(oldThread.autoArchiveDuration, lang) ?? oldThread.autoArchiveDuration} -> ${archiveName(newThread.autoArchiveDuration, lang) ?? newThread.autoArchiveDuration}`, inline: true });
  if ((oldThread.rateLimitPerUser ?? 0) !== (newThread.rateLimitPerUser ?? 0)) fields.push({ name: t(lang, 'logs.field.slowmode'), value: `${oldThread.rateLimitPerUser ?? 0}s -> ${newThread.rateLimitPerUser ?? 0}s`, inline: true });
  const archivedChanged = oldThread.archived !== newThread.archived;
  if (!fields.length && !archivedChanged) return;

  const mod = await fetchMod(newThread.guild, AuditLogEvent.ThreadUpdate, newThread.id);
  // A thread that archives itself after a quiet time happens all day, so archiving is only told when a person did it.
  if (archivedChanged && mod) fields.unshift({ name: t(lang, 'logs.thread.state'), value: t(lang, newThread.archived ? 'logs.thread.archived' : 'logs.thread.unarchived'), inline: true });
  if (!fields.length) return;
  if (mod) fields.push({ name: t(lang, 'logs.field.by'), value: mod, inline: true });
  await sendLog(client, newThread.guild.id, 'threads', {
    author: { name: t(lang, 'logs.thread.updated.title') },
    description: t(lang, 'logs.thread.updated.description', { thread: `<#${newThread.id}>` }),
    fields,
    footer: { text: t(lang, 'logs.thread.footer', { id: newThread.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [newThread.id, newThread.parentId] });
}

module.exports = { handleThreadCreate, handleThreadDelete, handleThreadUpdate };
