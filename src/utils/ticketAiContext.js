// i18n-ignore-file: builds data for the model, not text for people.
// What the AI assistant of the tickets may know besides the owner's texts: Discord messages of the server that the owner pointed to
// (its rules, for example; read live, so editing the message changes what the assistant knows) and the channels the ticket user can see
// with their topics, so it can answer "where is...?" by mentioning the channel. Everything here is data for the model, never instructions.
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { createExpiringCache } = require('./expiringCache');
const prompt = require('./ticketAiPrompt');
const logger = require('./logger');

const LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})$/;
// A message is read again after five minutes at most, so an edit reaches the assistant soon without a request per answer.
const messages = createExpiringCache(300_000, { name: 'ticket-ai-messages' });

const LISTED_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);

/** Everything a message says as text: its content, its embeds and the text displays of its components. */
function textOf(message) {
  const parts = [];
  if (message.content) parts.push(String(message.content));
  for (const embed of message.embeds ?? []) {
    const data = embed.data ?? embed;
    if (data.title) parts.push(String(data.title));
    if (data.description) parts.push(String(data.description));
    for (const field of data.fields ?? []) parts.push(`${field.name}: ${field.value}`);
  }
  const walk = (list) => {
    for (const item of list ?? []) {
      const content = typeof item?.content === 'string' ? item.content : item?.data?.content;
      if (content) parts.push(String(content));
      walk(item?.components);
      if (item?.accessory) walk([item.accessory]);
    }
  };
  walk(message.components);
  return parts.join('\n').trim();
}

/** The text of one linked message of this server, or '' (another server, a missing message or channel, or no permission to read it). */
async function readLink(guild, link) {
  const match = LINK.exec(String(link).trim());
  if (!match || match[1] !== guild.id) return '';
  return messages.get(`${guild.id}:${match[2]}:${match[3]}`, async () => {
    try {
      const channel = guild.channels.cache.get(match[2]) ?? await guild.channels.fetch(match[2]).catch(() => null);
      if (!channel?.isTextBased?.() || !channel.messages) return '';
      const message = await channel.messages.fetch(match[3]);
      return textOf(message);
    } catch (error) {
      logger.warn(`[ticket-ai] could not read a linked message of ${guild.id}: ${error.message}`);
      return '';
    }
  });
}

/** The channels the person can see, in the order of the server, with their topics. */
function visibleChannels(message) {
  const member = message.member;
  if (!member) return [];
  return [...message.guild.channels.cache.values()]
    .filter((channel) => LISTED_TYPES.has(channel.type) && channel.id !== message.channel.id && channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .slice(0, prompt.LIMITS.channels)
    .map((channel) => ({ id: channel.id, name: channel.name, topic: channel.topic ?? '' }));
}

/** The Discord part of the prompt for one answer: `{ messages: [{ text }], channels: [{ id, name, topic }] }`. */
async function build(message, settings) {
  const links = (settings.messageLinks ?? []).slice(0, prompt.LIMITS.discordMessages);
  const texts = await Promise.all(links.map((link) => readLink(message.guild, link)));
  return {
    messages: texts.filter(Boolean).map((text) => ({ text })),
    channels: settings.channelGuide === false ? [] : visibleChannels(message),
  };
}

/** The channel ids a reply may mention: the listed ones and those the owner wrote in a text or in a linked message. */
function allowedChannelIds(discord, ...texts) {
  const ids = prompt.channelIdsOf(discord);
  const found = [...texts, ...(discord.messages ?? []).map((item) => item.text)].join('\n').matchAll(/<#(\d{15,25})>/g);
  for (const [, id] of found) ids.add(id);
  return ids;
}

module.exports = { build, readLink, textOf, allowedChannelIds, visibleChannels };
