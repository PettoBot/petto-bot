// The counting channel: each message that is a number is checked against the one that had to come next. Messages that are not numbers are
// chat and are left alone. The numbers of one server are checked one at a time, so two people writing together cannot both be right.
const { Events, PermissionFlagsBits } = require('discord.js');
const db = require('../db/counting');
const { judge, afterCorrect, afterWrong, readNumber, deleteLater, trackTop } = require('../utils/counting');
const { plainCard } = require('../utils/plainCard');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

const queues = new Map();
function inOrder(guildId, task) {
  const before = queues.get(guildId) ?? Promise.resolve();
  const next = before.then(task, task).catch((error) => logger.error(`Counting failed in guild ${guildId}:`, error));
  queues.set(guildId, next);
  next.finally(() => { if (queues.get(guildId) === next) queues.delete(guildId); });
  return next;
}

// `alertSeconds` makes a message an alert that deletes itself (the answers about a mistake); the milestones and the saves stay.
const say = async (message, text, alertSeconds = 0) => {
  const sent = await message.channel.send({ ...plainCard(text, 0xa5ea7a), allowedMentions: { parse: [], users: [] } }).catch(() => null);
  deleteLater(sent, alertSeconds);
  return sent;
};
const alert = (message, text, config, color = 0xff6b6b) => message.channel.send({ ...plainCard(text, color), allowedMentions: { parse: [], users: [] } }).then((sent) => { deleteLater(sent, config.alert_seconds); return sent; }).catch(() => null);
const react = (message, emoji) => message.react(emoji).catch(() => null);

/** The mistake role: given to who got a number wrong, taken back after the time the server chose (or at their next right number). */
async function giveWrongRole(message, config, lang) {
  if (!config.wrong_role_id) return;
  try {
    const role = message.guild.roles.cache.get(config.wrong_role_id);
    if (!role || !role.editable) return;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    await member.roles.add(role, t(lang, 'counting.reason.wrong'));
    const minutes = Number(config.wrong_role_minutes);
    await db.rememberRole(message.guild.id, member.id, role.id, minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null);
  } catch (error) {
    logger.warn(`Counting: the mistake role could not be given in ${message.guild.id}: ${error.message}`);
  }
}

async function clearWrongRole(message, roleId, userId, lang) {
  try {
    const kept = await db.getRole(message.guild.id, userId);
    if (!kept) return;
    const member = message.member ?? await message.guild.members.fetch(userId).catch(() => null);
    await member?.roles.remove(kept.role_id, t(lang, 'counting.reason.right')).catch(() => {});
    await db.forgetRole(message.guild.id, userId);
  } catch (error) {
    logger.warn(`Counting: the mistake role could not be taken back in ${message.guild.id}: ${error.message}`);
  }
}

/** The role of the best counter moves to the new first place. */
async function moveTopRole(message, roleId, previousId, newId, lang) {
  try {
    const role = message.guild.roles.cache.get(roleId);
    if (!role || !role.editable) return;
    if (previousId) { const old = await message.guild.members.fetch(previousId).catch(() => null); await old?.roles.remove(role, t(lang, 'counting.reason.notTop')).catch(() => {}); }
    const next = message.member ?? await message.guild.members.fetch(newId).catch(() => null);
    await next?.roles.add(role, t(lang, 'counting.reason.top'));
  } catch (error) {
    logger.warn(`Counting: the role of the best counter could not be moved in ${message.guild.id}: ${error.message}`);
  }
}

/** Checks one message of the counting channel; what it says is in `lang`, the language of the server. */
async function check(message, lang = currentLanguage()) {
  const config = await db.getConfig(message.guild.id);
  const verdict = judge({ text: message.content, authorId: message.author.id, config });
  if (verdict.kind === 'ignore') return;
  const me = message.guild.members.me;
  const canDelete = message.channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageMessages);
  const who = `<@${message.author.id}>`;

  if (verdict.kind === 'ok') {
    const result = afterCorrect(config, verdict.number);
    const row = await db.bumpUser(message.guild.id, message.author.id, { correct: 1, streak: verdict.number });
    const top = trackTop(config, message.author.id, row.correct);
    await db.updateConfig(message.guild.id, { ...result.patch, last_user_id: message.author.id, last_message_id: message.id, top_user_id: top.topUserId, top_correct: top.topCorrect });
    if (top.changed && config.top_role_id) await moveTopRole(message, config.top_role_id, top.previous, message.author.id, lang);
    // A mistake role that lasts "until the next right number" ends now.
    if (config.wrong_role_id && Number(config.wrong_role_minutes) === 0) await clearWrongRole(message, config.wrong_role_id, message.author.id, lang);
    // The record reaction is only for the numbers that are a record AND fall on the step the server chose (every 100 by default; 0 never),
    // so it does not pile up on every number of a climb.
    const recordStep = Number(config.record_every) > 0 && result.record && verdict.number % Number(config.record_every) === 0;
    await react(message, recordStep ? config.react_record : config.react_ok);
    if (result.milestone) await say(message, t(lang, result.record ? 'counting.milestoneRecord' : 'counting.milestone', { number: verdict.number }));
    if (result.earnedSave) await say(message, t(lang, 'counting.saveEarned', { saves: result.patch.saves, max: config.saves_max }));
    return;
  }

  // The same person twice in a row is not a mistake of the number: the count stays where it was.
  if (verdict.kind === 'double') {
    await react(message, config.react_bad);
    await alert(message, t(lang, 'counting.double', { user: who, next: verdict.expected }), config, 0xffd563);
    if (config.delete_wrong && canDelete) await message.delete().catch(() => {});
    return;
  }

  const result = afterWrong(config);
  await db.updateConfig(message.guild.id, result.patch);
  await db.bumpUser(message.guild.id, message.author.id, { wrong: 1 });
  await react(message, config.react_bad);
  await giveWrongRole(message, config, lang);
  const vars = { user: who, number: verdict.number, expected: verdict.expected };
  if (result.saved) await alert(message, t(lang, 'counting.saved', { ...vars, left: result.patch.saves }), config, 0xffb86c);
  else if (result.reset) await alert(message, t(lang, 'counting.reset', { ...vars, at: verdict.expected - 1, start: Number(config.start_number ?? 0) + 1 }), config);
  else await alert(message, t(lang, 'counting.wrong', vars), config);
  if (config.delete_wrong && canDelete) await message.delete().catch(() => {});
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot || !message.guild || !message.content) return;
    try {
      const config = await db.getConfig(message.guild.id);
      if (!config.enabled || !config.channel_id || message.channel.id !== config.channel_id) return;
      // Chat is never put in the queue.
      if (readNumber(message.content, { math: config.math }) === null) return;
      const lang = currentLanguage();
      await inOrder(message.guild.id, () => check(message, lang));
    } catch (error) {
      logger.error(`Counting check failed in guild ${message.guild?.id}:`, error);
    }
  },
  check,
  inOrder,
};
