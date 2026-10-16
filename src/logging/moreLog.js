// More of what happens in a server, told in the category it belongs to (so nothing needs a channel of its own): poll votes and published
// messages in `messages`, invite links posted in `invites`, the permissions of an app's commands in `integrations`, who is interested in a
// scheduled event and the changes of onboarding in `server`, and what the staff does with cases and notes in `sanctions`.
const { sendLog, getAvatar, AuditLogEvent } = require('./engine');
const { t, guildLanguage } = require('../i18n');

const link = (guildId, channelId, messageId) => `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`;

// ---- polls: a vote added or taken back
async function handlePollVote(kind, answer, userId, client) {
  const message = answer?.poll?.message;
  const guild = message?.guild;
  if (!guild) return;
  const lang = await guildLanguage(guild.id);
  const question = answer.poll?.question?.text;
  const fields = [
    { name: t(lang, 'logs.poll.answer'), value: String(answer.text ?? '?').slice(0, 256), inline: true },
    { name: t(lang, 'logs.field.channel'), value: `<#${message.channelId}>`, inline: true },
  ];
  if (question) fields.unshift({ name: t(lang, 'logs.poll.question'), value: String(question).slice(0, 256), inline: false });
  fields.push({ name: t(lang, 'logs.pin.link'), value: t(lang, 'logs.pin.jump', { url: link(guild.id, message.channelId, message.id) }), inline: false });
  await sendLog(client, guild.id, 'messages', {
    author: { name: t(lang, `logs.poll.${kind}.title`) },
    description: t(lang, `logs.poll.${kind}.description`, { user: `<@${userId}>` }),
    fields,
    footer: { text: t(lang, 'logs.message.footer', { id: message.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [userId, message.channelId] });
}

// ---- a message of an announcement channel that was published to the servers following it
async function handleMessagePublished(oldMessage, newMessage, client) {
  const guild = newMessage.guild;
  if (!guild || !oldMessage?.flags || !newMessage.flags) return;
  if (oldMessage.flags.has('Crossposted') || !newMessage.flags.has('Crossposted')) return;
  const lang = await guildLanguage(guild.id);
  const fields = [{ name: t(lang, 'logs.field.channel'), value: `<#${newMessage.channelId}>`, inline: true }];
  if (newMessage.author) fields.push({ name: t(lang, 'logs.pin.author'), value: `<@${newMessage.author.id}>`, inline: true });
  if (newMessage.content) fields.push({ name: t(lang, 'logs.pin.message'), value: newMessage.content.slice(0, 500), inline: false });
  fields.push({ name: t(lang, 'logs.pin.link'), value: t(lang, 'logs.pin.jump', { url: link(guild.id, newMessage.channelId, newMessage.id) }), inline: false });
  await sendLog(client, guild.id, 'messages', {
    author: { name: t(lang, 'logs.message.published.title') },
    description: t(lang, 'logs.message.published.description', { channel: `<#${newMessage.channelId}>` }),
    fields,
    footer: { text: t(lang, 'logs.message.footer', { id: newMessage.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [newMessage.author?.id, newMessage.channelId].filter(Boolean) });
}

// ---- an invite link written in a message
const INVITE_LINK = /(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg)\/([\w-]{2,32})/gi;

/** The invite codes written in a text, each once. */
function inviteCodes(text) {
  return [...new Set([...String(text ?? '').matchAll(INVITE_LINK)].map((match) => match[1]))].slice(0, 5);
}

async function handleInvitePosted(message, client) {
  if (!message.guild || message.author?.bot || message.webhookId) return;
  const codes = inviteCodes(message.content);
  if (!codes.length) return;
  const lang = await guildLanguage(message.guild.id);
  await sendLog(client, message.guild.id, 'invites', {
    author: { name: t(lang, 'logs.invite.posted.title'), icon_url: getAvatar(message.author) ?? undefined },
    description: t(lang, 'logs.invite.posted.description', { user: `<@${message.author.id}>`, channel: `<#${message.channelId}>` }),
    fields: [
      { name: t(lang, 'logs.field.code'), value: codes.map((code) => `discord.gg/${code}`).join('\n'), inline: false },
      { name: t(lang, 'logs.pin.link'), value: t(lang, 'logs.pin.jump', { url: link(message.guild.id, message.channelId, message.id) }), inline: false },
    ],
    footer: { text: t(lang, 'logs.message.footer', { id: message.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [message.author.id, message.channelId] });
}

// ---- the permissions of the commands of an app, changed in Server Settings, Integrations
const PERMISSION_TARGETS = { 1: 'role', 2: 'user', 3: 'channel' };

function permissionLine(permission, guildId, lang) {
  const id = String(permission.id);
  const who = id === String(guildId) ? '`@everyone`'
    : permission.type === 3 && id === String(BigInt(guildId) - 1n) ? t(lang, 'logs.integration.allChannels')
      : permission.type === 1 ? `<@&${id}>` : permission.type === 3 ? `<#${id}>` : `<@${id}>`;
  return `${permission.permission ? '✅' : '⛔'} ${who}`;
}

async function handleCommandPermissions(data, client) {
  if (!data?.guildId) return;
  const lang = await guildLanguage(data.guildId);
  const everyCommand = String(data.id) === String(data.applicationId);
  const permissions = (data.permissions ?? []).map((permission) => permissionLine(permission, data.guildId, lang));
  await sendLog(client, data.guildId, 'integrations', {
    author: { name: t(lang, 'logs.integration.permissions.title') },
    description: t(lang, 'logs.integration.permissions.description', { app: `<@${data.applicationId}>`, target: everyCommand ? t(lang, 'logs.integration.allCommands') : `\`${data.id}\`` }),
    fields: [{ name: t(lang, 'logs.field.permissions'), value: permissions.join('\n').slice(0, 1000) || t(lang, 'logs.integration.noPermissions'), inline: false }],
    footer: { text: t(lang, 'logs.integration.footer', { id: data.applicationId }) },
    timestamp: new Date().toISOString(),
  });
}

// ---- who is interested in a scheduled event
async function handleEventInterest(kind, event, user, client) {
  const guild = event?.guild;
  if (!guild || !user) return;
  const lang = await guildLanguage(guild.id);
  await sendLog(client, guild.id, 'server', {
    author: { name: t(lang, `logs.event.interest.${kind}.title`), icon_url: getAvatar(user) ?? undefined },
    description: t(lang, `logs.event.interest.${kind}.description`, { user: `<@${user.id}>`, name: event.name }),
    footer: { text: t(lang, 'logs.event.footer', { id: event.id }) },
    timestamp: new Date().toISOString(),
  }, { ignoreIds: [user.id] });
}

// ---- onboarding and the server guide, from the audit log (Discord does not send an event for them)
const ONBOARDING_ENTRIES = new Map([
  [AuditLogEvent.OnboardingPromptCreate, 'questionAdded'],
  [AuditLogEvent.OnboardingPromptUpdate, 'questionUpdated'],
  [AuditLogEvent.OnboardingPromptDelete, 'questionRemoved'],
  [AuditLogEvent.OnboardingCreate, 'turnedOn'],
  [AuditLogEvent.OnboardingUpdate, 'updated'],
  [AuditLogEvent.HomeSettingsCreate, 'homeSet'],
  [AuditLogEvent.HomeSettingsUpdate, 'homeUpdated'],
]);

async function handleOnboardingEntry(entry, guild, client) {
  const kind = ONBOARDING_ENTRIES.get(entry?.action);
  if (!kind || !guild) return;
  const lang = await guildLanguage(guild.id);
  const fields = [];
  const changed = (entry.changes ?? []).map((change) => change.key).filter(Boolean);
  if (changed.length) fields.push({ name: t(lang, 'logs.onboarding.changes'), value: [...new Set(changed)].map((key) => `\`${key}\``).join(', ').slice(0, 1000), inline: false });
  if (entry.executor) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${entry.executor.id}>`, inline: true });
  await sendLog(client, guild.id, 'server', {
    author: { name: t(lang, `logs.onboarding.${kind}.title`) },
    description: t(lang, `logs.onboarding.${kind}.description`),
    fields,
    footer: { text: t(lang, 'logs.server.footer', { id: guild.id }) },
    timestamp: new Date().toISOString(),
  });
}

// ---- what the staff does with cases and notes of Petto, in `sanctions`
async function handleStaffAction(kind, client, guild, { moderator, user, number, type, count, note } = {}) {
  const lang = await guildLanguage(guild.id);
  const fields = [];
  if (user) fields.push({ name: t(lang, 'logs.mod.member'), value: `<@${user.id ?? user}>`, inline: true });
  if (number != null) fields.push({ name: t(lang, 'logs.mod.case'), value: `#${number}${type ? ` · ${type}` : ''}`, inline: true });
  if (count != null) fields.push({ name: t(lang, 'logs.mod.count'), value: String(count), inline: true });
  if (moderator) fields.push({ name: t(lang, 'logs.field.by'), value: `<@${moderator.id ?? moderator}>`, inline: true });
  if (note) fields.push({ name: t(lang, 'logs.mod.note'), value: String(note).slice(0, 800), inline: false });
  await sendLog(client, guild.id, 'sanctions', {
    author: { name: t(lang, `logs.mod.${kind}.title`) },
    description: t(lang, `logs.mod.${kind}.description`),
    fields,
    footer: { text: guild.name },
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  handlePollVote, handleMessagePublished, handleInvitePosted, inviteCodes, handleCommandPermissions, handleEventInterest,
  handleOnboardingEntry, handleStaffAction, ONBOARDING_ENTRIES,
};
