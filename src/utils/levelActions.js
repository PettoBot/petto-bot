const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const levelUsersDb = require('../db/levelUsers');
const levelRewardsDb = require('../db/levelRewards');
const levelMultipliersDb = require('../db/levelMultipliers');
const { levelForXp } = require('./levelCurve');
const { buildLevelData } = require('./levelData');
const { renderRankCard, CARD_FILE_NAME } = require('./cardService');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const { EMOJI } = require('./emojis');
const { getTemplate } = require('../db/embedTemplates');
const { build: buildEmbedTemplate } = require('./embedBuilder');
const { listEvents } = require('../db/xpEvents');
const { addPeriodXp } = require('../db/levelPeriods');
const { eventMultiplier, dailyBonus, utcDay } = require('./levelRules');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

// The level-up messages the database holds when a server wrote none, in English: they are shown in the server's language.
// The old text and voice defaults carried {EMOJI}; the text one drops it (the old star is not injected into the default).
const DEFAULT_MESSAGES = new Map([
  ['{user} just leveled up to **{level}**!', 'leveling.notify.default'], // i18n-ignore: stored default, compared
  ['{EMOJI} {user} just leveled up to **{level}**!', 'leveling.notify.default'], // i18n-ignore: stored default, compared
  ['{user} reached voice level **{level}**!', 'leveling.notify.voiceDefault'], // i18n-ignore: stored default, compared
  ['{EMOJI} {user} reached voice level **{level}**!', 'leveling.notify.voiceDefaultStar'], // i18n-ignore: stored default, compared
]);

// The day each member was last marked active, so a streak is touched in the database once a day and not on every message.
const touchedDay = new Map();

/**
 * What an award of XP is worth once the server's rules are applied: a running XP event multiplies it, and the first
 * activity of a day adds the daily and streak bonus. Neither can stop the award, a failure just leaves the plain XP.
 */
async function applyXpRules({ guild, member, config, xpGain, source }) {
  let gain = xpGain;
  try {
    gain = Math.round(gain * eventMultiplier(await listEvents(guild.id), source));
  } catch (err) {
    logger.warn(`XP events could not be read for ${guild.id}: ${err.message}`);
  }
  let bonus = 0;
  let streak = 0;
  try {
    const day = utcDay();
    const key = `${guild.id}:${member.id}`;
    if (touchedDay.get(key) !== day) {
      const touched = await levelUsersDb.touchStreak(guild.id, member.id, day);
      touchedDay.set(key, day);
      streak = touched.streak;
      if (touched.newDay) bonus = dailyBonus(config, touched.streak);
      if (touchedDay.size > 20_000) touchedDay.clear();
    }
  } catch (err) {
    logger.warn(`Streak could not be updated for ${member.id} in ${guild.id}: ${err.message}`);
  }
  return { xp: gain + bonus, bonus, streak };
}

/**
 * The combined multiplier for a message or a voice minute: the server's base multiplier, times the one of the member's roles, times the
 * one of the channel (or of its category when the channel has none of its own), never above the server's cap. With several roles the
 * server chooses (`multiplier_mode`): the highest one, all of them multiplied (`stack`), or each extra added to 1 (`sum`).
 * `channel` is the channel or just its id. A server with no multipliers and no base multiplier gives 1.
 */
async function getMultiplier(guildId, channel, member, config = null) {
  const base = Number(config?.xp_multiplier ?? 1);
  const multipliers = await levelMultipliersDb.listMultipliers(guildId);
  if (!multipliers.length) return base;

  const channelId = typeof channel === 'string' ? channel : channel?.id;
  const categoryId = typeof channel === 'string' ? null : channel?.parentId ?? channel?.parent?.id ?? null;
  let own = null;
  let category = null;
  const roles = [];
  for (const m of multipliers) {
    const value = Number(m.multiplier);
    if (m.target_type === 'channel' && m.target_id === channelId) own = value;
    else if (m.target_type === 'category' && categoryId && m.target_id === categoryId) category = value;
    else if (m.target_type === 'role' && member?.roles?.cache?.has(m.target_id)) roles.push(value);
  }

  const mode = config?.multiplier_mode ?? 'highest';
  let roleMult = 1;
  if (roles.length) {
    if (mode === 'stack') roleMult = roles.reduce((total, value) => total * value, 1);
    else if (mode === 'sum') roleMult = Math.max(0, 1 + roles.reduce((total, value) => total + (value - 1), 0));
    else roleMult = Math.max(...roles);
  }
  const channelMult = own ?? category ?? 1;
  const cap = Number(config?.multiplier_cap ?? 20);
  return Math.min(base * roleMult * channelMult, cap);
}

/**
 * Whether a member can earn XP here: not with a role the server left out, only with one of the roles the server picked (when it picked
 * some), and not in an ignored channel or category. `channel` is where the message was sent or the voice channel.
 */
function canEarnXp({ member, channel, config }) {
  const roleIds = member?.roles?.cache;
  const has = (id) => Boolean(roleIds?.has?.(id));
  if ((config?.no_xp_role_ids ?? []).some(has)) return false;
  const only = config?.only_xp_role_ids ?? [];
  if (only.length && !only.some(has)) return false;
  if (channel) {
    if ((config?.ignored_channel_ids ?? []).includes(channel.id)) return false;
    const parent = channel.parentId ?? channel.parent?.id;
    const threadParent = channel.isThread?.() ? channel.parent?.parentId : null;
    if ((config?.ignored_category_ids ?? []).some((id) => id === parent || id === threadParent)) return false;
  }
  return true;
}

/**
 * Grants/revokes the reward roles of the levels (`source` is `text` or `voice`) for a member who just reached `level`, per config.role_mode
 * ('highest' keeps only the top earned role, 'all' keeps every earned one). Returns the role that was added, or null when none was.
 */
async function checkRewards(guild, member, level, config, source = 'text') {
  const rewards = await levelRewardsDb.listRewards(guild.id, source);
  const earned = rewards.filter((r) => r.level <= level);
  if (!earned.length) return null;

  const me = guild.members.me;
  let gained = null;
  const usable = (r) => {
    const role = guild.roles.cache.get(r.role_id);
    return role && role.position < me.roles.highest.position ? role : null;
  };

  if (config.role_mode === 'highest') {
    const best = earned.reduce((a, b) => (b.level > a.level ? b : a));
    for (const r of earned) {
      const role = usable(r);
      if (!role) continue;
      if (r.role_id === best.role_id) {
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => {});
          gained = role;
        }
      } else if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role).catch(() => {});
      }
    }
  } else {
    for (const r of earned) {
      const role = usable(r);
      if (role && !member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => {});
        gained = role;
      }
    }
  }

  return gained;
}

/** Removes every level-reward role a member currently holds, of both kinds of level (used by /level reset). */
async function stripRewardRoles(guild, member) {
  const rewards = await levelRewardsDb.listRewards(guild.id, 'all');
  const toRemove = rewards.map((r) => guild.roles.cache.get(r.role_id)).filter((role, index, all) => role && member.roles.cache.has(role.id) && all.indexOf(role) === index);
  if (toRemove.length) await member.roles.remove(toRemove).catch(() => {});
}

/** The message the server wrote for this exact level (a milestone), or null. */
function milestoneFor(config, level) {
  const list = Array.isArray(config.notify_milestones) ? config.notify_milestones : [];
  const found = list.find((entry) => Number(entry?.level) === Number(level) && String(entry?.message ?? '').trim());
  return found ? String(found.message) : null;
}

/**
 * Gives a member the reward roles their levels have earned (messages and voice), without announcing anything. Used when a member comes
 * back and when the server syncs. Returns how many roles were added.
 */
async function syncRewardRoles(guild, member, row, config) {
  const { getVoiceConfig } = require('./levelSource');
  let added = 0;
  if (Number(row?.level) > 0 && await checkRewards(guild, member, Number(row.level), config, 'text').catch(() => null)) added += 1;
  if (Number(row?.voice_level) > 0 && await checkRewards(guild, member, Number(row.voice_level), getVoiceConfig(config), 'voice').catch(() => null)) added += 1;
  return added;
}

async function notifyLevelUp({ client, guild, member, config, level, channel, message = null, source = 'text', earnedRole = null, lang = currentLanguage() }) {
  if (config.notify_mode === 'off') return;
  const milestone = milestoneFor(config, level);
  // A level with a message of its own is always announced, whatever "every N levels" says.
  if (!milestone && config.notify_every > 1 && level % config.notify_every !== 0) return;

  const userData = await levelUsersDb.getUser(guild.id, member.id);
  const voice = source === 'voice';
  const xp = voice ? userData?.voice_xp ?? 0 : userData?.xp ?? 0;
  const rank = voice ? await levelUsersDb.getVoiceRank(guild.id, xp) : await levelUsersDb.getRank(guild.id, xp);
  const total = voice ? await levelUsersDb.countVoiceRanked(guild.id) : await levelUsersDb.countRanked(guild.id);

  const ctx = {
    member,
    guild,
    channel,
    message: message ?? undefined,
    user: member.user,
    levelData: { ...buildLevelData({ config, userData, source: voice ? 'voice' : 'messages', rank, total }), level },
    levelReward: earnedRole ? { id: earnedRole.id, name: earnedRole.name } : null,
  };

  // A message the server wrote (a milestone or its own) is sent as it is; the default one is translated.
  const defaultKey = DEFAULT_MESSAGES.get(config.notify_message);
  const configuredText = milestone ?? (defaultKey ? t(lang, defaultKey) : config.notify_message);
  const rawText = configuredText.replace(/\{EMOJI\}/g, EMOJI.STAR);
  const { text: cleanedText, emojis: reactReplies } = extractReactReplies(rawText);
  const text = await resolve(cleanedText, ctx);
  if (!text && reactReplies.length) {
    if (message) await applyReactReplies(message, reactReplies);
    return;
  }
  if (!text) return;
  let payload = null;
  if (config.notify_embed_template) {
    try {
      const template = await getTemplate(guild.id, config.notify_embed_template);
      if (template?.data) {
        const built = await buildEmbedTemplate(template.data, ctx);
        if (built.content || built.embeds?.length || built.components?.length || built.files?.length) {
          payload = { content: built.content || undefined, embeds: built.embeds, components: built.components, files: built.files };
        }
      }
    } catch (err) {
      logger.warn(`Level-up embed template failed for ${guild.id}:`, err.message);
    }
  }
  if (!payload) {
    payload = config.notify_embed
      ? { embeds: [new EmbedBuilder().setColor(0x4b4f59).setDescription(text)] }
      : { content: text };
  }

  // A card for the level-up: the picture goes inside the embed when there is one, and alone when there is not.
  const cardName = voice ? config.voice_notify_card ?? config.notify_card : config.notify_card;
  if (cardName && !payload.files?.length) {
    const file = await renderRankCard(ctx, cardName, voice ? 'voice' : 'messages');
    if (file) {
      payload.files = [new AttachmentBuilder(file.buffer, { name: file.name })];
      if (payload.embeds?.length) payload.embeds[0].setImage?.(`attachment://${CARD_FILE_NAME}`);
    }
  }

  // Who may be pinged: nobody when the server turned the ping off; the member when the text names them. A reply never pings by itself.
  payload.allowedMentions = config.notify_ping === false ? { parse: [], repliedUser: false } : { parse: ['users'], repliedUser: false };

  const afterSending = async (sent) => {
    if (!sent) return;
    if (reactReplies.length) await applyReactReplies(sent, reactReplies);
    const seconds = Number(config.notify_delete_after) || 0;
    if (seconds > 0 && typeof sent.delete === 'function') setTimeout(() => sent.delete().catch(() => {}), seconds * 1000).unref?.();
  };

  try {
    if (config.notify_mode === 'dm') {
      await afterSending(await member.send(payload));
      return;
    }
    let target = channel;
    if (config.notify_mode === 'channel' && config.notify_channel_id) target = await guild.channels.fetch(config.notify_channel_id).catch(() => null);
    else if (voice && !target && config.notify_channel_id) target = await guild.channels.fetch(config.notify_channel_id).catch(() => null);
    if (!target) return;
    // It answers the message that made the member level up when it goes to the same channel (and the server did not turn replies off).
    if (config.notify_reply !== false && message && message.channelId === target.id) payload.reply = { messageReference: message.id, failIfNotExists: false };
    await afterSending(await require('./senderIdentity').sendAs(target, 'levelup', payload));
  } catch (err) {
    logger.warn(`Level-up notification failed for ${member.id} in guild ${guild.id}:`, err.message);
  }
}

/**
 * The single entry point for granting XP (from a message or a voice-minute tick): adds XP,
 * recomputes the level under the guild's curve, and — if it went up — applies reward roles
 * and sends the level-up notification. Shared by both XP sources so neither can drift.
 */
async function grantXp({ client, guild, member, config, xpGain, messageInc = 0, vcInc = 0, channel = null, message = null }) {
  const before = await levelUsersDb.ensureUser(guild.id, member.id);
  const oldLevel = before.level;

  const award = await applyXpRules({ guild, member, config, xpGain, source: 'text' });
  // The daily limit is on what messages earn; the daily and streak bonus come on top of it.
  if (Number(config.daily_xp_cap) > 0) {
    try {
      const fits = await levelUsersDb.takeDailyXp(guild.id, member.id, utcDay(), award.xp - award.bonus, config.daily_xp_cap);
      award.xp = fits + award.bonus;
    } catch (err) {
      logger.warn(`The daily XP limit could not be applied for ${member.id} in ${guild.id}: ${err.message}`);
    }
  }
  const updated = await levelUsersDb.addXp(guild.id, member.id, { xpGain: award.xp, messageInc, vcInc });
  addPeriodXp(guild.id, member.id, { textXp: award.xp }).catch((err) => logger.warn(`Weekly XP could not be saved for ${member.id}: ${err.message}`));
  const newLevel = Math.min(levelForXp(updated.xp, config), config.max_level);

  if (newLevel !== updated.level) await levelUsersDb.setLevel(guild.id, member.id, newLevel);

  if (newLevel > oldLevel) {
    const earnedRole = await checkRewards(guild, member, newLevel, config, 'text').catch((err) => { logger.error('Level reward grant failed:', err); return null; });
    await notifyLevelUp({ client, guild, member, config, level: newLevel, channel, message, earnedRole }).catch((err) => logger.error('Level notify failed:', err));
  }

  return { ...updated, level: newLevel, leveledUp: newLevel > oldLevel, bonusXp: award.bonus, streak: award.streak };
}

async function grantVoiceXp({ client, guild, member, config, xpGain, vcInc = 1, channel = null, message = null }) {
  const before = await levelUsersDb.ensureUser(guild.id, member.id);
  const oldLevel = before.voice_level ?? 0;

  const award = await applyXpRules({ guild, member, config, xpGain, source: 'voice' });
  const updated = await levelUsersDb.addVoiceXp(guild.id, member.id, { xpGain: award.xp, vcInc });
  addPeriodXp(guild.id, member.id, { voiceXp: award.xp }).catch((err) => logger.warn(`Weekly voice XP could not be saved for ${member.id}: ${err.message}`));
  const newLevel = Math.min(levelForXp(updated.voice_xp ?? 0, config), config.max_level);

  if (newLevel !== oldLevel) await levelUsersDb.setVoiceLevel(guild.id, member.id, newLevel);

  if (newLevel > oldLevel) {
    const earnedRole = await checkRewards(guild, member, newLevel, config, 'voice').catch((err) => { logger.error('Voice level reward grant failed:', err); return null; });
    await notifyLevelUp({ client, guild, member, config, level: newLevel, channel, message, source: 'voice', earnedRole }).catch((err) => logger.error('Voice level notify failed:', err));
  }

  return { ...updated, level: newLevel, leveledUp: newLevel > oldLevel, bonusXp: award.bonus, streak: award.streak };
}

module.exports = { syncRewardRoles, getMultiplier, canEarnXp, milestoneFor, checkRewards, stripRewardRoles, notifyLevelUp, grantXp, grantVoiceXp };
