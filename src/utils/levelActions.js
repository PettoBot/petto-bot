const { EmbedBuilder } = require('discord.js');
const levelUsersDb = require('../db/levelUsers');
const levelRewardsDb = require('../db/levelRewards');
const levelMultipliersDb = require('../db/levelMultipliers');
const { levelForXp, xpNeeded } = require('./levelCurve');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const { EMOJI } = require('./emojis');
const { getTemplate } = require('../db/embedTemplates');
const { build: buildEmbedTemplate } = require('./embedBuilder');
const logger = require('./logger');

/** Combined multiplier for a message/voice-minute: the largest matching role multiplier, multiplied by a matching channel multiplier (both default to 1 if unset). */
async function getMultiplier(guildId, channelId, member) {
  const multipliers = await levelMultipliersDb.listMultipliers(guildId);
  if (!multipliers.length) return 1;

  let roleMult = 1;
  let channelMult = 1;

  for (const m of multipliers) {
    if (m.target_type === 'channel' && m.target_id === channelId) channelMult = Number(m.multiplier);
    if (m.target_type === 'role' && member?.roles.cache.has(m.target_id)) roleMult = Math.max(roleMult, Number(m.multiplier));
  }

  return roleMult * channelMult;
}

/** Grants/revokes level_rewards roles for a member who just reached `level`, per config.role_mode ('highest' keeps only the top earned role, 'all' keeps every earned one). Returns true if a new role was actually added. */
async function checkRewards(guild, member, level, config) {
  const rewards = await levelRewardsDb.listRewards(guild.id);
  const earned = rewards.filter((r) => r.level <= level);
  if (!earned.length) return false;

  const me = guild.members.me;
  let gainedNew = false;

  if (config.role_mode === 'highest') {
    const best = earned.reduce((a, b) => (b.level > a.level ? b : a));
    for (const r of earned) {
      const role = guild.roles.cache.get(r.role_id);
      if (!role || role.position >= me.roles.highest.position) continue;
      if (r.role_id === best.role_id) {
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => {});
          gainedNew = true;
        }
      } else if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role).catch(() => {});
      }
    }
  } else {
    for (const r of earned) {
      const role = guild.roles.cache.get(r.role_id);
      if (!role || role.position >= me.roles.highest.position) continue;
      if (!member.roles.cache.has(role.id)) {
        await member.roles.add(role).catch(() => {});
        gainedNew = true;
      }
    }
  }

  return gainedNew;
}

/** Removes every level-reward role a member currently holds (used by /level reset). */
async function stripRewardRoles(guild, member) {
  const rewards = await levelRewardsDb.listRewards(guild.id);
  const toRemove = rewards.map((r) => guild.roles.cache.get(r.role_id)).filter((role) => role && member.roles.cache.has(role.id));
  if (toRemove.length) await member.roles.remove(toRemove).catch(() => {});
}

async function notifyLevelUp({ client, guild, member, config, level, channel, message = null, source = 'text' }) {
  if (config.notify_mode === 'off') return;
  if (config.notify_every > 1 && level % config.notify_every !== 0) return;

  const userData = await levelUsersDb.getUser(guild.id, member.id);
  const xp = source === 'voice' ? userData?.voice_xp ?? 0 : userData?.xp ?? 0;
  const rank = source === 'voice' ? await levelUsersDb.getVoiceRank(guild.id, xp) : await levelUsersDb.getRank(guild.id, xp);

  const ctx = {
    member,
    guild,
    channel,
    user: member.user,
    levelData: { level, xp, xpNeeded: xpNeeded(level, config), rank, source },
  };

  // Keep old databases compatible, but do not inject the old star into the default.
  const configuredText = config.notify_message === '{EMOJI} {user} just leveled up to **{level}**!'
    ? '{user} just leveled up to **{level}**!'
    : config.notify_message;
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
        if (built.content || built.embeds?.length || built.components?.length) {
          payload = { content: built.content || undefined, embeds: built.embeds, components: built.components };
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

  try {
    if (config.notify_mode === 'dm') {
      const sent = await member.send(payload);
      if (reactReplies.length) await applyReactReplies(sent, reactReplies);
    } else if (config.notify_mode === 'channel' && config.notify_channel_id) {
      const target = await guild.channels.fetch(config.notify_channel_id).catch(() => null);
      if (target) {
        const sent = await target.send(payload);
        if (reactReplies.length) await applyReactReplies(sent, reactReplies);
      }
    } else if (channel) {
      const sent = await channel.send(payload);
      if (reactReplies.length) await applyReactReplies(sent, reactReplies);
    }
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

  const updated = await levelUsersDb.addXp(guild.id, member.id, { xpGain, messageInc, vcInc });
  const newLevel = Math.min(levelForXp(updated.xp, config), config.max_level);

  if (newLevel !== updated.level) await levelUsersDb.setLevel(guild.id, member.id, newLevel);

  if (newLevel > oldLevel) {
    await checkRewards(guild, member, newLevel, config).catch((err) => logger.error('Level reward grant failed:', err));
    await notifyLevelUp({ client, guild, member, config, level: newLevel, channel, message }).catch((err) => logger.error('Level notify failed:', err));
  }

  return { ...updated, level: newLevel, leveledUp: newLevel > oldLevel };
}

async function grantVoiceXp({ client, guild, member, config, xpGain, vcInc = 1, channel = null, message = null }) {
  const before = await levelUsersDb.ensureUser(guild.id, member.id);
  const oldLevel = before.voice_level ?? 0;

  const updated = await levelUsersDb.addVoiceXp(guild.id, member.id, { xpGain, vcInc });
  const newLevel = Math.min(levelForXp(updated.voice_xp ?? 0, config), config.max_level);

  if (newLevel !== oldLevel) await levelUsersDb.setVoiceLevel(guild.id, member.id, newLevel);

  if (newLevel > oldLevel) {
    await checkRewards(guild, member, newLevel, config).catch((err) => logger.error('Voice level reward grant failed:', err));
    await notifyLevelUp({ client, guild, member, config, level: newLevel, channel, message, source: 'voice' }).catch((err) => logger.error('Voice level notify failed:', err));
  }

  return { ...updated, level: newLevel, leveledUp: newLevel > oldLevel };
}

module.exports = { getMultiplier, checkRewards, stripRewardRoles, notifyLevelUp, grantXp, grantVoiceXp };
