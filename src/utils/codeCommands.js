// Runs custom commands written in code (Petto Code). The code only says what it wants (see src/scripting); this file
// is where the bot decides what it will really do, so a command can never do more than its member could.
const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const logger = require('./logger');
const { run, check, PettoCodeError, MAX_SOURCE_LENGTH } = require('../scripting');
const { tokenize } = require('../handlers/prefixInteraction');
const commandData = require('../db/commandData');

const COOLDOWN_MS = 2000;
const MAX_MESSAGE = 2000;
const cooldowns = new Map(); // `${guildId}:${userId}:${command}` -> time of the last run

// A command must not hand out a role that lets someone moderate or change the server.
const RISKY_PERMISSIONS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.MentionEveryone,
];

/** Who can write code commands: the owner, the developers and the testers, or everyone once it is open. */
function canWriteCode(userId) {
  if (config.codeCommandsPublic) return true;
  return userId === config.ownerId || config.developerIds.includes(userId) || config.codeCommandTesterIds.includes(userId);
}

/** The data the code can read (docs: data.md), taken from the message that used the command. */
function buildData(message, commandName, argText, prefix) {
  const { guild, channel, author, member } = message;
  return {
    User: {
      ID: author.id, Username: author.username, GlobalName: author.globalName ?? null, Mention: `<@${author.id}>`,
      Avatar: author.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? null, IsBot: Boolean(author.bot),
    },
    Member: {
      Nick: member?.nickname ?? null, DisplayName: member?.displayName ?? author.username,
      RoleIDs: member ? [...member.roles.cache.keys()].filter((id) => id !== guild.id) : [],
      JoinedAt: member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null,
    },
    Guild: { ID: guild.id, Name: guild.name, MemberCount: guild.memberCount ?? null, Icon: guild.iconURL?.({ extension: 'png', size: 256 }) ?? null },
    Channel: { ID: channel.id, Name: channel.name ?? null, Mention: `<#${channel.id}>` },
    Message: {
      ID: message.id, Content: message.content ?? '', Link: message.url ?? null,
      Embeds: (message.embeds ?? []).slice(0, 10).map((embed) => ({ Title: embed.title ?? null, Description: embed.description ?? null, Footer: embed.footer?.text ?? null })),
    },
    Args: tokenize(argText ?? ''),
    RawArgs: argText ?? '',
    Cmd: commandName,
    Prefix: prefix,
    Trigger: 'command',
    Button: null,
    Values: [],
  };
}

// ── Buttons and menus ───────────────────────────────────────────────────────
const COMPONENT_PREFIX = 'cc:';

/** The id Discord keeps for a button or a menu: cc:<command>:<handler>:<data>:<u + user id, or nothing>. At most 97 characters. */
function componentId(commandName, spec) {
  return `${COMPONENT_PREFIX}${commandName}:${spec.handler}:${spec.data ?? ''}:${spec.userId ? `u${spec.userId}` : ''}`;
}

function parseComponentId(customId) {
  const parts = String(customId).split(':');
  if (parts[0] !== 'cc' || parts.length !== 5) return null;
  const [, command, handler, data, lock] = parts;
  if (!command || !handler) return null;
  return { command, handler, data, userId: lock.startsWith('u') ? lock.slice(1) : null };
}

/** The rows of buttons and menus of a message, as discord.js builds them. */
function buildComponents(rows, commandName) {
  return rows.map((row) => {
    const builder = new ActionRowBuilder();
    for (const item of row.items) {
      if (item.type === 'select') {
        const menu = new StringSelectMenuBuilder().setCustomId(componentId(commandName, item)).setMinValues(item.min).setMaxValues(item.max)
          .addOptions(item.options.map((option) => ({ label: option.label, value: option.value, ...(option.description ? { description: option.description } : {}) })));
        if (item.placeholder) menu.setPlaceholder(item.placeholder);
        builder.addComponents(menu);
      } else {
        const button = new ButtonBuilder().setStyle(item.style);
        if (item.label) button.setLabel(item.label);
        if (item.emoji) button.setEmoji(item.emoji);
        if (item.disabled) button.setDisabled(true);
        if (item.url) button.setURL(item.url); else button.setCustomId(componentId(commandName, item));
        builder.addComponents(button);
      }
    }
    return builder;
  });
}

/** The ids a text mentions on purpose, so only those can be pinged. */
function mentionedIds(content) {
  const users = new Set();
  const roles = new Set();
  for (const match of String(content ?? '').matchAll(/<@!?(\d{15,22})>/g)) users.add(match[1]);
  for (const match of String(content ?? '').matchAll(/<@&(\d{15,22})>/g)) roles.add(match[1]);
  return { users: [...users], roles: [...roles] };
}

function allowedMentionsFor(content, guild, authorId) {
  const { users, roles } = mentionedIds(content);
  return {
    parse: [],
    users: [...new Set([authorId, ...users])],
    roles: roles.filter((id) => guild.roles.cache.get(id)?.mentionable),
    repliedUser: false,
  };
}

const clip = (text) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text);

/** What a message of the code looks like when sent: text, an embed, or both. */
function toPayload(action, guild, authorId, commandName = null) {
  const payload = { allowedMentions: allowedMentionsFor(action.content, guild, authorId) };
  if (action.content) payload.content = clip(action.content);
  if (action.embed) payload.embeds = [new EmbedBuilder(action.embed)];
  if (action.components?.length && commandName) payload.components = buildComponents(action.components, commandName);
  return payload;
}

function canGiveRole(guild, role) {
  if (!role) return 'that role does not exist';
  if (role.id === guild.id || role.managed) return 'that role cannot be given';
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'Petto needs the Manage Roles permission';
  if (role.position >= me.roles.highest.position) return 'that role is above Petto\'s highest role';
  if (RISKY_PERMISSIONS.some((flag) => role.permissions.has(flag))) return 'a role with moderation or server permissions cannot be given by a command';
  return null;
}

/** Does what the code asked, as far as it is allowed. Returns the reasons for what was left undone. */
async function applyEffects(message, effects, commandName = null) {
  const { guild, author, member } = message;
  const skipped = [];
  const me = guild.members.me;
  for (const effect of effects) {
    try {
      if (effect.type === 'message') {
        const channel = effect.channelId ? guild.channels.cache.get(effect.channelId) : message.channel;
        if (!channel?.isTextBased?.() || channel.isDMBased?.()) { skipped.push('a message to a channel that is not in this server'); continue; }
        const botCan = channel.permissionsFor(me);
        const memberCan = channel.permissionsFor(member);
        if (!botCan?.has(PermissionFlagsBits.SendMessages) || !botCan.has(PermissionFlagsBits.ViewChannel)) { skipped.push(`a message to #${channel.name}, Petto cannot send there`); continue; }
        if (!memberCan?.has(PermissionFlagsBits.SendMessages)) { skipped.push(`a message to #${channel.name}, you cannot send there`); continue; }
        await channel.send(toPayload(effect, guild, author.id, commandName));
      } else if (effect.type === 'dm') {
        await author.send({ ...toPayload(effect, guild, author.id), allowedMentions: { parse: [] } }).catch(() => skipped.push('a direct message, you have them closed'));
      } else if (effect.type === 'addRole' || effect.type === 'removeRole') {
        const role = guild.roles.cache.get(effect.roleId);
        const problem = canGiveRole(guild, role);
        if (problem) { skipped.push(`${effect.type === 'addRole' ? 'giving' : 'taking'} a role: ${problem}`); continue; }
        if (effect.type === 'addRole') await member.roles.add(role, 'Custom command'); else await member.roles.remove(role, 'Custom command');
      } else if (effect.type === 'reaction') {
        await message.react(effect.emoji).catch(() => skipped.push(`the reaction ${effect.emoji}`));
      }
    } catch (error) {
      logger.warn(`A custom command action failed (${effect.type}) in guild ${guild.id}: ${error.message}`);
      skipped.push(effect.type);
    }
  }
  // The trigger goes last, so the answer can still reply to it.
  if (effects.some((effect) => effect.type === 'deleteTrigger') && guild.members.me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => {});
  }
  return skipped;
}

/**
 * A store that lives only in memory, with the same functions as the real one. Test runs use it, so trying code that stores
 * things never changes what the server has stored.
 */
function memoryStore() {
  const data = new Map();
  const id = (key, user) => `${user}\u0000${key}`;
  return {
    async get(key, user) { return data.has(id(key, user)) ? data.get(id(key, user)) : null; },
    async set(key, value, user) { data.set(id(key, user), value); },
    async del(key, user) { data.delete(id(key, user)); },
    async incr(key, amount, user) {
      const current = data.has(id(key, user)) ? data.get(id(key, user)) : 0;
      if (typeof current !== 'number') throw new Error('That key does not hold a number');
      data.set(id(key, user), current + amount);
      return current + amount;
    },
    async top(key, limit) {
      return [...data.entries()].map(([k, value]) => [k.split('\u0000'), value]).filter(([[user, name], value]) => user && name === key && typeof value === 'number')
        .sort((a, b) => b[1] - a[1]).slice(0, limit).map(([[user], value]) => ({ UserID: user, Value: value }));
    },
    async keys(prefix, user) { return [...data.keys()].map((k) => k.split('\u0000')).filter(([u, name]) => u === user && name.startsWith(prefix)).map(([, name]) => name).sort().slice(0, 100); },
  };
}

const mistakeText = (error) => `⚠️ The code of this command has a mistake: ${error.detail ?? error.message}\nA server admin can fix it.`;

/** Runs the code of a custom command for the message that used it. Returns true when the message was handled. */
async function runCodeCommand(message, row, argText, prefix) {
  const key = `${message.guild.id}:${message.author.id}:${row.name}`;
  const last = cooldowns.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) return true;
  cooldowns.set(key, Date.now());
  if (cooldowns.size > 5000) for (const [stale, at] of cooldowns) if (Date.now() - at > COOLDOWN_MS) cooldowns.delete(stale);

  let result;
  try {
    result = await run(row.code, buildData(message, row.name, argText, prefix), { store: commandData.forGuild(message.guild.id) });
  } catch (error) {
    if (error instanceof PettoCodeError) {
      await message.reply({ content: clip(mistakeText(error)), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
      return true;
    }
    logger.error(`Custom command "${row.name}" crashed in guild ${message.guild.id}:`, error);
    return true;
  }
  const text = result.output.trim();
  if (text) await message.reply({ content: clip(text), allowedMentions: allowedMentionsFor(text, message.guild, message.author.id) }).catch(() => {});
  const skipped = await applyEffects(message, result.effects, row.name);
  if (skipped.length) {
    await message.reply({ content: clip(`⚠️ Some actions were not done: ${[...new Set(skipped)].join('; ')}.`), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  }
  return true;
}

/**
 * Runs the code of a command because someone used one of its buttons or menus. The command runs again with `.Trigger` set to
 * "button" or "select", `.Button.ID` and `.Button.Data` from the component, and `.Values` for a menu.
 */
async function runComponent(interaction, row, parsed) {
  const ephemeralReply = (content) => interaction.reply({ content: clip(content), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
  if (parsed.userId && parsed.userId !== interaction.user.id) return ephemeralReply('This is not for you.');
  const key = `${interaction.guildId}:${interaction.user.id}:${row.name}:${parsed.handler}`;
  if (Date.now() - (cooldowns.get(key) ?? 0) < COOLDOWN_MS / 2) return interaction.deferUpdate().catch(() => {});
  cooldowns.set(key, Date.now());

  const { guild, channel, user, member } = interaction;
  // The pieces of a message that the data and the actions use, taken from the message the component is on.
  const source = {
    id: interaction.message?.id ?? interaction.id, content: interaction.message?.content ?? '', url: interaction.message?.url ?? null, embeds: interaction.message?.embeds ?? [],
    guild, channel, member, author: user,
    react: async () => { throw new Error('A reaction needs the message of a command'); }, delete: async () => {},
  };
  const data = {
    ...buildData(source, row.name, '', '!'),
    Trigger: interaction.isStringSelectMenu?.() ? 'select' : 'button',
    Button: { ID: parsed.handler, Data: parsed.data },
    Values: interaction.isStringSelectMenu?.() ? [...interaction.values] : [],
  };

  let result;
  try {
    result = await run(row.code, data, { store: commandData.forGuild(guild.id), limits: { maxMillis: 2000 } });
  } catch (error) {
    if (error instanceof PettoCodeError) return ephemeralReply(mistakeText(error));
    logger.error(`Custom command "${row.name}" crashed on a component in guild ${guild.id}:`, error);
    return interaction.deferUpdate().catch(() => {});
  }

  const update = result.effects.find((effect) => effect.type === 'update');
  const respond = result.effects.find((effect) => effect.type === 'respond');
  const text = result.output.trim();
  const rest = result.effects.filter((effect) => effect.type !== 'update' && effect.type !== 'respond');

  // Answer first, Discord only waits three seconds, then do the rest.
  try {
    if (update) await interaction.update(toPayload(update, guild, user.id, row.name));
    else if (respond) await interaction.reply({ ...toPayload(respond, guild, user.id, row.name), ...(respond.ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
    else if (text) await interaction.reply({ content: clip(text), allowedMentions: allowedMentionsFor(text, guild, user.id) });
    else await interaction.deferUpdate();
  } catch (error) {
    logger.warn(`Could not answer the component of "${row.name}" in guild ${guild.id}: ${error.message}`);
    return null;
  }
  const skipped = await applyEffects(source, rest, row.name);
  if (skipped.length) {
    await interaction.followUp({ content: clip(`⚠️ Some actions were not done: ${[...new Set(skipped)].join('; ')}.`), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
  }
  return null;
}

/** Takes the code out of what was typed: with or without a code block around it. */
function extractCode(text) {
  const trimmed = String(text ?? '').trim();
  // A code block (with or without a language after the three backticks), read by hand so long input costs nothing extra.
  if (trimmed.length >= 6 && trimmed.startsWith('```') && trimmed.endsWith('```')) {
    const inside = trimmed.slice(3, -3);
    const firstLineEnd = inside.indexOf('\n');
    const language = firstLineEnd === -1 ? inside : inside.slice(0, firstLineEnd);
    const hasLanguage = firstLineEnd !== -1 && language.length <= 20 && [...language].every((char) => /[A-Za-z0-9_-]/.test(char));
    return (hasLanguage || firstLineEnd === 0 ? inside.slice(firstLineEnd + 1) : inside).trim();
  }
  const inline = trimmed.length > 2 && trimmed.startsWith('`') && trimmed.endsWith('`') && !trimmed.slice(1, -1).includes('`') ? trimmed.slice(1, -1) : null;
  return (inline ?? trimmed).trim();
}

/**
 * The text typed after the command, the subcommand and `words` more, exactly as it was written. The prefix commands
 * split everything on white space, which would lose the lines of the code, so the code is read from the message itself.
 */
function rawAfter(content, words) {
  const found = [...String(content ?? '').matchAll(/\S+/g)];
  const first = found[0]?.[0]?.startsWith('<@') ? 1 : 0; // a command that starts with a mention of the bot
  const last = found[first + 1 + words];
  if (!last) return '';
  return String(content).slice(last.index + last[0].length).trim();
}

const SHARE_PREFIX = 'pc1.';

/** A command as a code that can be shared and imported: pc1. + the base64url of { v, n, d, c }. */
function encodeShare({ name, description = '', code }) {
  return `${SHARE_PREFIX}${Buffer.from(JSON.stringify({ v: 1, n: name, d: description, c: code }), 'utf8').toString('base64url')}`;
}

function decodeShare(text) {
  const raw = String(text ?? '').trim();
  if (!raw.startsWith(SHARE_PREFIX)) throw new Error('A share code starts with pc1.');
  let data;
  try { data = JSON.parse(Buffer.from(raw.slice(SHARE_PREFIX.length), 'base64url').toString('utf8')); } catch { throw new Error('That share code is damaged'); }
  if (!data || data.v !== 1 || typeof data.c !== 'string') throw new Error('That share code is not one of Petto Code');
  if (data.c.length > MAX_SOURCE_LENGTH) throw new Error('The code in that share code is too long');
  const name = typeof data.n === 'string' ? data.n.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
  return { name, description: typeof data.d === 'string' ? data.d.slice(0, 200) : '', code: data.c };
}

module.exports = { COMPONENT_PREFIX, parseComponentId, componentId, buildComponents, runComponent, memoryStore, canWriteCode, buildData, runCodeCommand, applyEffects, extractCode, rawAfter, encodeShare, decodeShare, allowedMentionsFor, check, COOLDOWN_MS, RISKY_PERMISSIONS };
