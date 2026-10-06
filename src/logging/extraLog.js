// The smaller things the log also tells: pinned messages, stage events, soundboard sounds, integrations and bots added or removed,
// and which commands of Petto were used. Everything here is cheap: it only works when a log channel is set for the category, and a
// command is logged by its name only, never with what was typed after it.
const { sendLog, getAvatar, fetchEntry, AuditLogEvent } = require('./engine');

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
  for (const [type, title, verb] of [[AuditLogEvent.MessagePin, 'Message Pinned', 'pinned'], [AuditLogEvent.MessageUnpin, 'Message Unpinned', 'unpinned']]) {
    for (const entry of await recentEntries(guild, type)) {
      if (entry.extra?.channel?.id && entry.extra.channel.id !== channel.id) continue;
      const messageId = entry.extra?.messageId;
      const message = messageId ? await channel.messages.fetch(messageId).catch(() => null) : null;
      const fields = [{ name: 'Channel', value: `<#${channel.id}>`, inline: true }];
      if (entry.executor) fields.push({ name: 'By', value: `<@${entry.executor.id}>`, inline: true });
      if (message?.author) fields.push({ name: 'Author', value: `<@${message.author.id}>`, inline: true });
      if (message?.content) fields.push({ name: 'Message', value: message.content.slice(0, 500), inline: false });
      if (messageId) fields.push({ name: 'Link', value: `[Jump to the message](https://discord.com/channels/${guild.id}/${channel.id}/${messageId})`, inline: false });
      await sendLog(client, guild.id, 'messages', {
        author: { name: title },
        description: `A message was ${verb} in <#${channel.id}>`,
        fields,
        footer: { text: messageId ? `Message ID: ${messageId}` : `Channel ID: ${channel.id}` },
        timestamp: new Date().toISOString(),
      }, { ignoreIds: [channel.id] });
    }
  }
}

// ---- stage events, in the `voice` category
async function handleStage(kind, stage, oldStage, client) {
  const guild = stage.guild ?? oldStage?.guild;
  if (!guild) return;
  const fields = [{ name: 'Stage', value: stage.channelId ? `<#${stage.channelId}>` : 'Unknown', inline: true }];
  let title = 'Stage Started';
  let description = `A stage started: **${stage.topic}**`;
  if (kind === 'delete') { title = 'Stage Ended'; description = `The stage **${stage.topic}** ended`; }
  if (kind === 'update') {
    if (!oldStage || oldStage.topic === stage.topic) return;
    title = 'Stage Topic Changed';
    description = `The topic of a stage was changed`;
    fields.push({ name: 'Topic', value: `${oldStage.topic} -> ${stage.topic}`, inline: false });
  }
  await sendLog(client, guild.id, 'voice', {
    author: { name: title },
    description,
    fields,
    footer: { text: `Stage ID: ${stage.id}` },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [stage.channelId] });
}

// ---- soundboard sounds, in the `emojis` category (the same place as stickers)
function soundFields(sound, by) {
  const fields = [];
  if (sound.emoji?.name) fields.push({ name: 'Emoji', value: sound.emoji.id ? `<:${sound.emoji.name}:${sound.emoji.id}>` : sound.emoji.name, inline: true });
  if (sound.volume != null) fields.push({ name: 'Volume', value: `${Math.round(sound.volume * 100)}%`, inline: true });
  if (by) fields.push({ name: 'By', value: by, inline: true });
  return fields;
}

async function handleSound(kind, sound, oldSound, client) {
  const guild = sound.guild ?? oldSound?.guild;
  if (!guild) return;
  const types = { create: AuditLogEvent.SoundboardSoundCreate, update: AuditLogEvent.SoundboardSoundUpdate, delete: AuditLogEvent.SoundboardSoundDelete };
  const entry = types[kind] ? await fetchEntry(guild, types[kind], sound.soundId ?? sound.id) : null;
  const by = entry?.executor ? `<@${entry.executor.id}>` : sound.user ? `<@${sound.user.id}>` : null;
  const titles = { create: 'Sound Added', update: 'Sound Updated', delete: 'Sound Removed' };
  const fields = soundFields(sound, by);
  if (kind === 'update') {
    if (!oldSound) return;
    const changes = [];
    if (oldSound.name !== sound.name) changes.push({ name: 'Name', value: `\`${oldSound.name}\` -> \`${sound.name}\``, inline: false });
    if (oldSound.volume !== sound.volume) changes.push({ name: 'Volume', value: `${Math.round((oldSound.volume ?? 1) * 100)}% -> ${Math.round((sound.volume ?? 1) * 100)}%`, inline: true });
    if (!changes.length) return;
    fields.unshift(...changes);
  }
  await sendLog(client, guild.id, 'emojis', {
    author: { name: titles[kind] },
    description: `The soundboard sound \`${sound.name}\` was ${kind === 'create' ? 'added to' : kind === 'delete' ? 'removed from' : 'updated in'} the server`,
    fields,
    footer: { text: `Sound ID: ${sound.soundId ?? sound.id ?? 'unknown'}` },
    timestamp: new Date().toISOString(),
  });
}

// ---- integrations (apps, Twitch, YouTube...) created, changed and removed, in the `integrations` category
async function handleIntegrationsUpdate(guild, client) {
  const kinds = [[AuditLogEvent.IntegrationCreate, 'Integration Added', 'was added'], [AuditLogEvent.IntegrationUpdate, 'Integration Updated', 'was updated'], [AuditLogEvent.IntegrationDelete, 'Integration Removed', 'was removed']];
  for (const [type, title, verb] of kinds) {
    for (const entry of await recentEntries(guild, type)) {
      const name = entry.target?.name ?? entry.changes?.find((c) => c.key === 'name')?.new ?? entry.changes?.find((c) => c.key === 'name')?.old ?? 'Unknown';
      const kind = entry.target?.type ?? entry.changes?.find((c) => c.key === 'type')?.new;
      const fields = [];
      if (kind) fields.push({ name: 'Kind', value: String(kind), inline: true });
      if (entry.executor) fields.push({ name: 'By', value: `<@${entry.executor.id}>`, inline: true });
      await sendLog(client, guild.id, 'integrations', {
        author: { name: title },
        description: `The integration \`${name}\` ${verb}`,
        fields,
        footer: { text: `Integration ID: ${entry.targetId ?? 'unknown'}` },
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// ---- bots added to or removed from the server, in the `integrations` category
async function handleBotAdded(member, client) {
  if (!member.user?.bot) return;
  const entry = await fetchEntry(member.guild, AuditLogEvent.BotAdd, member.id);
  const fields = [{ name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }];
  if (entry?.executor) fields.push({ name: 'Added by', value: `<@${entry.executor.id}>`, inline: true });
  const permissions = member.permissions?.has?.('Administrator');
  if (permissions) fields.push({ name: 'Warning', value: 'It can have the Administrator permission', inline: false });
  await sendLog(client, member.guild.id, 'integrations', {
    author: { name: 'Bot Added', icon_url: getAvatar(member.user) ?? undefined },
    description: `The bot <@${member.id}> (\`${member.user.username}\`) was added to the server`,
    fields,
    footer: { text: `Bot ID: ${member.id}` },
    timestamp: new Date().toISOString(),
  });
}

async function handleBotRemoved(member, client) {
  if (!member.user?.bot) return;
  const entry = await fetchEntry(member.guild, AuditLogEvent.MemberKick, member.id);
  const fields = [];
  if (entry?.executor) fields.push({ name: 'By', value: `<@${entry.executor.id}>`, inline: true });
  await sendLog(client, member.guild.id, 'integrations', {
    author: { name: 'Bot Removed', icon_url: getAvatar(member.user) ?? undefined },
    description: `The bot <@${member.id}> (\`${member.user.username}\`) is no longer in the server`,
    fields,
    footer: { text: `Bot ID: ${member.id}` },
    timestamp: new Date().toISOString(),
  });
}

// ---- command use, in the `commands` category. Only the name of the command is logged, never what was typed after it.
async function handleCommandUsed({ guild, user, channel, name, prefix, subcommand }, client) {
  if (!guild || !user || user.bot) return;
  const shown = `${prefix}${name}${subcommand ? ` ${subcommand}` : ''}`;
  await sendLog(client, guild.id, 'commands', {
    author: { name: 'Command Used', icon_url: getAvatar(user) ?? undefined },
    description: `<@${user.id}> used \`${shown}\`${channel ? ` in <#${channel.id}>` : ''}`,
    fields: [
      { name: 'Command', value: `\`${shown}\``, inline: true },
      ...(channel ? [{ name: 'Channel', value: `<#${channel.id}>`, inline: true }] : []),
      { name: 'How', value: prefix === '/' ? 'Slash command' : 'Message prefix', inline: true },
    ],
    footer: { text: `User ID: ${user.id}` },
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
