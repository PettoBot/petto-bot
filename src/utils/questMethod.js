// The extras of a quest alert: a thread opened under the alert so people can talk about that quest, and the "method" message, the
// server's own explanation of how to complete quests (steps, pictures, several texts, anything an embed can hold), sent in that
// thread or in a channel, with a ping or without it.
const questApi = require('./questApi');
const questsDb = require('../db/quests');
const { templatePayload } = require('./templatedMessage');
const { questContext, templateForQuest } = require('./questMessages');
const logger = require('./logger');
const { sendAs } = require('./senderIdentity');
const { t, currentLanguage, guildLanguage } = require('../i18n');

const ARCHIVE_MINUTES = [60, 1440, 4320, 10080];
const DEFAULT_THREAD_NAME = '{quest.name}';
const TEXT_LIMIT = 2000;

/** `{quest.name}` and the other quest variables in a plain text. What is not a quest variable stays as it is. */
function fillQuest(text, quest, kind = 'new', lang = currentLanguage()) {
  const context = questContext(quest, kind, lang);
  return String(text ?? '').replace(/\{quest\.([a-z_.]+)\}/gi, (whole, key) => (key.toLowerCase() in context ? String(context[key.toLowerCase()] ?? '') : whole));
}

function threadName(settings, quest, lang = currentLanguage()) {
  const name = fillQuest(settings.thread_name || DEFAULT_THREAD_NAME, quest, 'new', lang).replace(/\s+/g, ' ').trim();
  return (name || quest.name || t(lang, 'quests.thread.fallbackName')).slice(0, 100);
}

/** Opens the thread under an alert message. Returns the thread, or null when it could not be made (missing permission, a channel that cannot have one). */
async function startQuestThread(message, settings, quest, lang = currentLanguage()) {
  try {
    const archive = ARCHIVE_MINUTES.includes(settings.thread_archive) ? settings.thread_archive : 1440;
    const thread = await message.startThread({ name: threadName(settings, quest, lang), autoArchiveDuration: archive, reason: t(lang, 'quests.thread.reason') });
    // A ping inside the thread adds the people of the role to it.
    if (settings.thread_ping && settings.role_id) {
      await thread.send({ content: `<@&${settings.role_id}>`, allowedMentions: { parse: [], roles: [settings.role_id] } }).catch(() => null);
    }
    return thread;
  } catch (error) {
    logger.warn({ guildId: settings.guild_id, action: 'quest-thread' }, `A quest thread could not be opened: ${error.message}`);
    return null;
  }
}

/** The method message of a server for a quest, or null when it has none (no saved embed and no text). */
async function methodPayload(guild, settings, quest, lang = currentLanguage()) {
  const ping = settings.method_ping && settings.role_id ? `<@&${settings.role_id}>` : null;
  const mentions = { parse: [], roles: ping ? [settings.role_id] : [] };
  const names = [templateForQuest(settings.method_type_templates, quest), settings.method_template].filter((name, index, all) => name && all.indexOf(name) === index);
  for (const name of names) {
    const payload = await templatePayload(guild.id, name, { guild, quest: questContext(quest, 'new', lang) }, { v2Extras: { prefixText: ping ? `-# ${ping}` : null } });
    if (payload?.flags) return { ...payload, allowedMentions: mentions };
    if (payload) return { ...payload, content: [ping, payload.content].filter(Boolean).join('\n') || undefined, allowedMentions: mentions };
  }
  const text = fillQuest(settings.method_text, quest, 'new', lang).trim();
  if (!text) return null;
  return { content: [ping, text].filter(Boolean).join('\n').slice(0, 4000), allowedMentions: mentions };
}

/** Where the method goes: the thread of the alert, or the channel the server picked (the alert channel when none was). */
async function methodTarget(guild, settings, thread) {
  if (settings.method_target !== 'channel' && thread) return thread;
  const id = (settings.method_target === 'channel' ? settings.method_channel_id : null) || settings.channel_id;
  const channel = id ? await guild.channels.fetch(id).catch(() => null) : null;
  return channel?.isTextBased?.() ? channel : null;
}

/** Sends the method for a quest. `thread` is the thread of its alert, when there is one. Returns where it went, or null. */
async function sendMethod(guild, settings, quest, thread = null, lang = currentLanguage()) {
  const payload = await methodPayload(guild, settings, quest, lang);
  if (!payload) return null;
  const target = await methodTarget(guild, settings, thread);
  if (!target) return null;
  const sent = await sendAs(target, 'quests', payload).catch((error) => {
    logger.warn({ guildId: guild.id, action: 'quest-method' }, `The quest method could not be sent: ${error.message}`);
    return null;
  });
  return sent ? target : null;
}

/** The thread under the alert that was posted for a quest in a server, or null. */
async function findAlertThread(guild, settings, questId) {
  const post = await questsDb.getPost(guild.id, questId, 'new').catch(() => null);
  if (!post?.message_id || !settings.channel_id) return null;
  const channel = await guild.channels.fetch(settings.channel_id).catch(() => null);
  const message = channel?.isTextBased?.() ? await channel.messages.fetch(post.message_id).catch(() => null) : null;
  return message?.thread ?? null;
}

/**
 * Sends the method of a server for a quest now (the newest active one when `questId` is empty), for the command and the dashboard.
 * Returns `{ ok, message }` where `message` says what happened.
 */
async function sendMethodNow(guild, settings, { questId = null, api = questApi, lang = currentLanguage() } = {}) {
  let quests;
  try { quests = (await api.getQuests()).filter((quest) => api.isActive(quest)); } catch (error) { return { ok: false, message: t(lang, 'quests.readFailed', { error: error.message }) }; }
  quests.sort((a, b) => (b.startsAt - a.startsAt) || b.id.localeCompare(a.id));
  const quest = questId ? quests.find((entry) => entry.id === questId) : quests[0];
  if (!quest) return { ok: false, message: t(lang, questId ? 'quests.method.notActive' : 'quests.noActive') };
  if (!settings.method_template && !templateForQuest(settings.method_type_templates, quest) && !String(settings.method_text ?? '').trim()) return { ok: false, message: t(lang, 'quests.method.none') };
  const thread = settings.method_target === 'channel' ? null : await findAlertThread(guild, settings, quest.id);
  // The method goes to the server in its own language, even when the dashboard asked for it.
  const target = await sendMethod(guild, settings, quest, thread, await guildLanguage(guild.id));
  if (!target) return { ok: false, message: t(lang, 'quests.method.sendFailed') };
  return { ok: true, message: t(lang, 'quests.method.sent', { name: quest.name, channel: `<#${target.id}>` }), channelId: target.id };
}

module.exports = { ARCHIVE_MINUTES, DEFAULT_THREAD_NAME, TEXT_LIMIT, fillQuest, threadName, startQuestThread, methodPayload, methodTarget, sendMethod, findAlertThread, sendMethodNow };
