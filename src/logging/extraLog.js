// The smaller things the log also tells: pinned messages, stage events, soundboard sounds, integrations and bots added or removed,
// and which commands of Petto were used. Everything here is cheap: it only works when a log channel is set for the category, and a
// command is logged by its name only, never with what was typed after it.
const { sendLog, getAvatar, fetchEntry, AuditLogEvent } = require('./engine');
const { t, guildLanguage } = require('../i18n');
const { permissionName } = require('../utils/permissionLabels');

const MAX_AGE_MS = 15_000;
const told = new Map();
/** The audit log entries that were already told, kept for a minute. */
function fresh(entry, now = Date.now()) {
  for (const [id, at] of told) if (now - at > 60_000) told.delete(id);
  if (!entry || told.has(entry.id) || now - entry.createdTimestamp > MAX_AGE_MS) return false;
  told.set(entry.id, now);
  return true;
}

async function recentEntries(guild, type) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    return [...logs.entries.values()].filter((entry) => fresh(entry));
  } catch {
    return []; // Without View Audit Log there is nothing to tell apart.
  }
}

// ---- pins: Discord only says that the pins of a channel changed, the audit log says which message and who
async function handleChannelPins(channel, client) {
  const guild = channel.guild;
  if (!guild) return;
  const lang = await guildLanguage(guild.id);
  for (const [type, what] of [[AuditLogEvent.MessagePin, 'pinned'], [AuditLogEvent.MessageUnpin, 'unpinned']]) {
    for (const entry of await recentEntries(guild, type)) {
      if (entry.extra?.channel?.id && entry.extra.channel.id !== channel.id) continue;
      const messageId = entry.extra?.messageId;
      const message = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
      const fields = [{ name: t(lang, 'logs.field.channel'), value: `<#${channel.id}>`, inline: true }];
      if (entry.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${entry.executor.id}>`, inline: true });
      if (message?.author) fields.push({ name: t(lang, 'logs.pin.author'), value: `<@${message.author.id}>`, inline: true });
      if (message?.content) fields.push({ name: t(lang, 'logs.pin.message'), value: message.content.slice(0, 500), inline: false });
      if (messageId) fields.push({ name: t(lang, 'logs.pin.link'), value: t(lang, 'logs.pin.jump', { url: `https://discord.com/channels/${guild.id}/${channel.id}/${messageId}` }), inline: false });
      await sendLog(client, guild.id, 'messages', {
        author: { name: t(lang, `logs.pin.${what}.title`) },
        description: t(lang, `logs.pin.${what}.description`, { channel: `<#${channel.id}>` }),
        fields,
        footer: { text: messageId ? t(lang, 'logs.message.footer', { id: messageId }) : t(lang, 'logs.channel.footer', { id: channel.id }) },
        timestamp: new Date().toISOString(),
      }, { ignoreIds: [channel.id] });
    }
  }
}

// ---- stage events, in the `voice` category
async function handleStage(kind, stage, oldStage, client) {
  const guild = stage.guild ?? oldStage?.guild;
  if (!guild) return;
  if (kind === 'update' && (!oldStage || oldStage.topic === stage.topic)) return;
  const lang = await guildLanguage(guild.id);
  const fields = [{ name: t(lang, 'logs.stage.stage'), value: stage.channelId ? `<#${stage.channelId}>` : t(lang, 'logs.unknown'), inline: true }];
  let title = t(lang, 'logs.stage.started.title');
  let description = t(lang, 'logs.stage.started.description', { topic: stage.topic });
  if (kind === 'delete') { title = t(lang, 'logs.stage.ended.title'); description = t(lang, 'logs.stage.ended.description', { topic: stage.topic }); }
  if (kind === 'update') {
    title = t(lang, 'logs.stage.topic.title');
    description = t(lang, 'logs.stage.topic.description');
    fields.push({ name: t(lang, 'logs.field.topic'), value: `${oldStage.topic} -> ${stage.topic}`, inline: false });
  }
  await sendLog(client, guild.id, 'voice', {
    author: { name: title },
    description,
    fields,
    footer: { text: t(lang, 'logs.stage.footer', { id: stage.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [stage.channelId] });
}

// ---- soundboard sounds, in the `emojis` category (the same place as stickers)
function soundFields(sound, by, lang) {
  const fields = [];
  if (sound.emoji?.name) fields.push({ name: t(lang, 'logs.field.emoji'), value: sound.emoji.id ? `<:${sound.emoji.name}:${sound.emoji.id}>` : sound.emoji.name, inline: true });
  if (sound.volume != null) fields.push({ name: t(lang, 'logs.sound.volume'), value: `${Math.round(sound.volume * 100)}%`, inline: true });
  if (by) fields.push({ name: t(lang, 'logs.field.by'), value: by, inline: true });
  return fields;
}

async function handleSound(kind, sound, oldSound, client) {
  const guild = sound.guild ?? oldSound?.guild;
  if (!guild) return;
  const lang = await guildLanguage(guild.id);
  const types = { create: AuditLogEvent.SoundboardSoundCreate, update: AuditLogEvent.SoundboardSoundUpdate, delete: AuditLogEvent.SoundboardSoundDelete };
  const entry = types[kind] ? await fetchEntry(guild, types[kind], sound.soundId ?? sound.id) : null;
  const by = entry?.executor ? `<@${entry.executor.id}>` : sound.user ? `<@${sound.user.id}>` : null;
  const fields = soundFields(sound, by, lang);
  if (kind === 'update') {
    if (!oldSound) return;
    const changes = [];
    if (oldSound.name !== sound.name) changes.push({ name: t(lang, 'logs.field.name'), value: `\`${oldSound.name}\` -> \`${sound.name}\``, inline: false });
    if (oldSound.volume !== sound.volume) changes.push({ name: t(lang, 'logs.sound.volume'), value: `${Math.round((oldSound.volume ?? 1) * 100)}% -> ${Math.round((sound.volume ?? 1) * 100)}%`, inline: true });
    if (!changes.length) return;
    fields.unshift(...changes);
  }
  const what = kind === 'create' ? 'added' : kind === 'delete' ? 'removed' : 'updated';
  await sendLog(client, guild.id, 'emojis', {
    author: { name: t(lang, `logs.sound.${what}.title`) },
    description: t(lang, `logs.sound.${what}.description`, { name: sound.name }),
    fields,
    footer: { text: t(lang, 'logs.sound.footer', { id: sound.soundId ?? sound.id ?? t(lang, 'logs.unknownId') }) },
    timestamp: new Date().toISOString(),
  });
}

// ---- integrations (apps, Twitch, YouTube...) created, changed and removed, in the `integrations` category
async function handleIntegrationsUpdate(guild, client) {
  const lang = await guildLanguage(guild.id);
  const kinds = [[AuditLogEvent.IntegrationCreate, 'added'], [AuditLogEvent.IntegrationUpdate, 'updated'], [AuditLogEvent.IntegrationDelete, 'removed']];
  for (const [type, what] of kinds) {
    for (const entry of await recentEntries(guild, type)) {
      const name = entry.target?.name ?? entry.changes?.find((c) => c.key === 'name')?.new ?? entry.changes?.find((c) => c.key === 'name')?.old ?? t(lang, 'logs.unknown');
      const kind = entry.target?.type ?? entry.changes?.find((c) => c.key === 'type')?.new;
      const fields = [];
      if (kind) fields.push({ name: t(lang, 'logs.field.kind'), value: String(kind), inline: true });
      if (entry.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${entry.executor.id}>`, inline: true });
      await sendLog(client, guild.id, 'integrations', {
        author: { name: t(lang, `logs.integration.${what}.title`) },
        description: t(lang, `logs.integration.${what}.description`, { name }),
        fields,
        footer: { text: t(lang, 'logs.integration.footer', { id: entry.targetId ?? t(lang, 'logs.unknownId') }) },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// ---- bots added to or removed from the server, in the `integrations` category
async function handleBotAdded(member, client) {
  if (!member.user?.bot) return;
  const lang = await guildLanguage(member.guild.id);
  const entry = await fetchEntry(member.guild, AuditLogEvent.BotAdd, member.id);
  const fields = [{ name: t(lang, 'logs.field.accountCreated'), value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }];
  if (entry?.executor) fields.push({ name: t(lang, 'logs.bot.addedBy'), value: `<@${entry.executor.id}>`, inline: true });
  const permissions = member.permissions?.has?.('Administrator');
  if (permissions) fields.push({ name: t(lang, 'logs.bot.warning'), value: t(lang, 'logs.bot.administrator', { permission: permissionName('Administrator', lang) }), inline: false });
  await sendLog(client, member.guild.id, 'integrations', {
    author: { name: t(lang, 'logs.bot.added.title'), icon_url: getAvatar(member.user) ?? undefined },
    description: t(lang, 'logs.bot.added.description', { bot: `<@${member.id}>`, username: member.user.username }),
    fields,
    footer: { text: t(lang, 'logs.bot.footer', { id: member.id }) },
    timestamp: new Date().toISOString(),
  });
}

async function handleBotRemoved(member, client) {
  if (!member.user?.bot) return;
  const lang = await guildLanguage(member.guild.id);
  const entry = await fetchEntry(member.guild, AuditLogEvent.MemberKick, member.id);
  const fields = [];
  if (entry?.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${entry.executor.id}>`, inline: true });
  await sendLog(client, member.guild.id, 'integrations', {
    author: { name: t(lang, 'logs.bot.removed.title'), icon_url: getAvatar(member.user) ?? undefined },
    description: t(lang, 'logs.bot.removed.description', { bot: `<@${member.id}>`, username: member.user.username }),
    fields,
    footer: { text: t(lang, 'logs.bot.footer', { id: member.id }) },
    timestamp: new Date().toISOString(),
  });
}

// ---- command use, in the `commands` category. Only the name of the command is logged, never what was typed after it.
async function handleCommandUsed({ guild, user, channel, name, prefix, subcommand }, client) {
  if (!guild || !user || user.bot) return;
  const lang = await guildLanguage(guild.id);
  const shown = `${prefix}${name}${subcommand ? ` ${subcommand}` : ''}`;
  await sendLog(client, guild.id, 'commands', {
    author: { name: t(lang, 'logs.command.title'), icon_url: getAvatar(user) ?? undefined },
    description: channel
      ? t(lang, 'logs.command.descriptionIn', { user: `<@${user.id}>`, command: shown, channel: `<#${channel.id}>` })
      : t(lang, 'logs.command.description', { user: `<@${user.id}>`, command: shown }),
    fields: [
      { name: t(lang, 'logs.command.command'), value: `\`${shown}\``, inline: true },
      ...(channel ? [{ name: t(lang, 'logs.field.channel'), value: `<#${channel.id}>`, inline: true }] : []),
      { name: t(lang, 'logs.command.how'), value: t(lang, prefix === '/' ? 'logs.command.slash' : 'logs.command.prefix'), inline: true },
    ],
    footer: { text: t(lang, 'logs.footer.user', { id: user.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [user.id, channel?.id] });
}

/** Called when a command runs. It never waits and never throws: a log must not slow down or break a command. */
function logCommandUse(details, client) {
  try {
    handleCommandUsed(details, client).catch(() => {});
  } catch {
    // ignored on purpose
  }
}

module.exports = {
  handleChannelPins, handleStage, handleSound, handleIntegrationsUpdate, handleBotAdded, handleBotRemoved, handleCommandUsed, logCommandUse,
};
