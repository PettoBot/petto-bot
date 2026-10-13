// The counting channel: each message that is a number is checked against the one that had to come next. Messages that are not numbers are
// chat and are left alone. The numbers of one server are checked one at a time, so two people writing together cannot both be right.
const { Events, PermissionFlagsBits } = require('discord.js');
const db = require('../db/counting');
const { judge, afterCorrect, afterWrong, readNumber } = require('../utils/counting');
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

const say = (message, text) => message.channel.send({ ...plainCard(text), allowedMentions: { parse: [], users: [] } }).catch(() => null);
const react = (message, emoji) => message.react(emoji).catch(() => null);

async function check(message) {
  const config = await db.getConfig(message.guild.id);
  const verdict = judge({ text: message.content, authorId: message.author.id, config });
  if (verdict.kind === 'ignore') return;
  const me = message.guild.members.me;
  const canDelete = message.channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageMessages);
  const who = `<@${message.author.id}>`;

  if (verdict.kind === 'ok') {
    const result = afterCorrect(config, verdict.number);
    await db.updateConfig(message.guild.id, { ...result.patch, last_user_id: message.author.id, last_message_id: message.id });
    await db.bumpUser(message.guild.id, message.author.id, { correct: 1, streak: verdict.number });
    await react(message, result.record ? config.react_record : config.react_ok);
    if (result.milestone) await say(message, `**${verdict.number}** reached! Keep going.${result.record ? ' It is a new record.' : ''}`);
    if (result.earnedSave) await say(message, `The server earned a save: ${result.patch.saves}/${config.saves_max}. A save is used when somebody gets a number wrong.`);
    return;
  }

  // The same person twice in a row is not a mistake of the number: the count stays where it was.
  if (verdict.kind === 'double') {
    await react(message, config.react_bad);
    await say(message, `${who} you cannot count two numbers in a row. Wait for someone else. The next number is **${verdict.expected}**.`);
    if (config.delete_wrong && canDelete) await message.delete().catch(() => {});
    return;
  }

  const result = afterWrong(config);
  await db.updateConfig(message.guild.id, result.patch);
  await db.bumpUser(message.guild.id, message.author.id, { wrong: 1 });
  await react(message, config.react_bad);
  if (result.saved) await say(message, `${who} wrote **${verdict.number}** and the next one was **${verdict.expected}**, but a save was used (${result.patch.saves} left). The next number is still **${verdict.expected}**.`);
  else if (result.reset) await say(message, `${who} messed up at **${verdict.expected - 1}**: they wrote **${verdict.number}** and it had to be **${verdict.expected}**. The count starts again from **${Number(config.start_number ?? 0) + 1}**.`);
  else await say(message, `${who} wrote **${verdict.number}** and the next one was **${verdict.expected}**. The count goes on.`);
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
