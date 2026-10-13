// The counting channel: each message that is a number is checked against the one that had to come next. Messages that are not numbers are
// chat and are left alone. The numbers of one server are checked one at a time, so two people writing together cannot both be right.
const { Events, PermissionFlagsBits } = require('discord.js');
const db = require('../db/counting');
const { judge, afterCorrect, afterWrong, readNumber, deleteLater, trackTop } = require('../utils/counting');
const { plainCard } = require('../utils/plainCard');
const logger = require('../utils/logger');

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
async function giveWrongRole(message, config) {
  if (!config.wrong_role_id) return;
  try {
    const role = message.guild.roles.cache.get(config.wrong_role_id);
    if (!role || !role.editable) return;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    await member.roles.add(role, 'Counting: wrong number');
    const minutes = Number(config.wrong_role_minutes);
    await db.rememberRole(message.guild.id, member.id, role.id, minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null);
  } catch (error) {
    logger.warn(`Counting: the mistake role could not be given in ${message.guild.id}: ${error.message}`);
  }
}

async function clearWrongRole(message, roleId, userId) {
  try {
    const kept = await db.getRole(message.guild.id, userId);
    if (!kept) return;
    const member = message.member ?? await message.guild.members.fetch(userId).catch(() => null);
    await member?.roles.remove(kept.role_id, 'Counting: a right number').catch(() => {});
    await db.forgetRole(message.guild.id, userId);
  } catch (error) {
    logger.warn(`Counting: the mistake role could not be taken back in ${message.guild.id}: ${error.message}`);
  }
}

/** The role of the best counter moves to the new first place. */
async function moveTopRole(message, roleId, previousId, newId) {
  try {
    const role = message.guild.roles.cache.get(roleId);
    if (!role || !role.editable) return;
    if (previousId) { const old = await message.guild.members.fetch(previousId).catch(() => null); await old?.roles.remove(role, 'Counting: no longer the best counter').catch(() => {}); }
    const next = message.member ?? await message.guild.members.fetch(newId).catch(() => null);
    await next?.roles.add(role, 'Counting: the best counter');
  } catch (error) {
    logger.warn(`Counting: the role of the best counter could not be moved in ${message.guild.id}: ${error.message}`);
  }
}

async function check(message) {
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
    if (top.changed && config.top_role_id) await moveTopRole(message, config.top_role_id, top.previous, message.author.id);
    // A mistake role that lasts "until the next right number" ends now.
    if (config.wrong_role_id && Number(config.wrong_role_minutes) === 0) await clearWrongRole(message, config.wrong_role_id, message.author.id);
    await react(message, result.record ? config.react_record : config.react_ok);
    if (result.milestone) await say(message, `**${verdict.number}** reached! Keep going.${result.record ? ' It is a new record.' : ''}`);
    if (result.earnedSave) await say(message, `The server earned a save: ${result.patch.saves}/${config.saves_max}. A save is used when somebody gets a number wrong.`);
    return;
  }

  // The same person twice in a row is not a mistake of the number: the count stays where it was.
  if (verdict.kind === 'double') {
    await react(message, config.react_bad);
    await alert(message, `${who} you cannot count two numbers in a row. Wait for someone else. The next number is **${verdict.expected}**.`, config, 0xffd563);
    if (config.delete_wrong && canDelete) await message.delete().catch(() => {});
    return;
  }

  const result = afterWrong(config);
  await db.updateConfig(message.guild.id, result.patch);
  await db.bumpUser(message.guild.id, message.author.id, { wrong: 1 });
  await react(message, config.react_bad);
  await giveWrongRole(message, config);
  if (result.saved) await alert(message, `${who} wrote **${verdict.number}** and the next one was **${verdict.expected}**, but a save was used (${result.patch.saves} left). The next number is still **${verdict.expected}**.`, config, 0xffb86c);
  else if (result.reset) await alert(message, `${who} messed up at **${verdict.expected - 1}**: they wrote **${verdict.number}** and it had to be **${verdict.expected}**. The count starts again from **${Number(config.start_number ?? 0) + 1}**.`, config);
  else await alert(message, `${who} wrote **${verdict.number}** and the next one was **${verdict.expected}**. The count goes on.`, config);
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
      await inOrder(message.guild.id, () => check(message));
    } catch (error) {
      logger.error(`Counting check failed in guild ${message.guild?.id}:`, error);
    }
  },
  check,
  inOrder,
};
