const { isPermissionError, permissionHelp } = require('../utils/permissionErrors');
const { Events, MessageFlags, PermissionsBitField } = require('discord.js');
const { plainMessage } = require('../utils/cardService');
const { ensureGuild } = require('../db/guilds');
const { buildInteractionFromMessage, tokenize } = require('../handlers/prefixInteraction');
const { unknownSubcommandCard, missingOptionCard } = require('../utils/usageCard');
const commandAliasesDb = require('../db/commandAliases');
const { getRemainingCooldownShared } = require('../utils/sharedCooldown');
const disabledDb = require('../db/disabledCommands');
const permissionsDb = require('../db/permissions');
const customCommandsDb = require('../db/customCommands');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('../utils/embedBuilder');
const { resolve } = require('../utils/embedVariables');
const { extractReactReplies, extractReactRepliesFromTemplate, applyReactReplies } = require('../utils/messageFlags');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const moderationPermissions = require('../utils/moderationPermissions');
const { controlAction } = require('../utils/autoModControl');
const { restrictedFor, applyWordRoute } = require('../utils/commandRestrictions');
const logger = require('../utils/logger');
const { logCommandUse } = require('../logging/extraLog');
const { runCodeCommand } = require('../utils/codeCommands');
const { findTrigger } = require('../utils/codeTriggers');
const { peekGuildLanguage, t, formatDecimal } = require('../i18n');
// Loaded when a message comes in: it reaches for the configuration and the database, which the checks do without.
const activeUserPrefix = async (...args) => require('../utils/userPrefixAccess').activeUserPrefix(...args);

const DEFAULT_COOLDOWN_MS = 3000;
const UNKNOWN_COMMAND_DELETE_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const prefixCache = new Map(); // guildId -> { prefix, expiresAt }

function normalizePrefix(prefix) {
  const value = typeof prefix === 'string' ? prefix.trim() : '';
  return value || '!';
}

function prefixMatches(content, prefix) {
  if (typeof content !== 'string' || !prefix || content.length < prefix.length) return false;
  return content.slice(0, prefix.length).toLocaleLowerCase() === prefix.toLocaleLowerCase();
}

function parsePrefixCommand(content, prefix) {
  if (!prefixMatches(content, prefix)) return null;

  const withoutPrefix = content.slice(prefix.length).trim();
  if (!withoutPrefix) return null;

  // Accept `p!help`, `p! help`, tabs, and repeated whitespace while keeping
  // the rest of the argument text intact for the existing tokenizer.
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(withoutPrefix);
  if (!match) return null;

  return {
    typedPrefix: content.slice(0, prefix.length),
    commandName: match[1].toLowerCase(),
    argText: match[2] ?? '',
  };
}

function permissionKey(json) {
  const raw = json.default_member_permissions;
  if (raw == null) return 'n/a';
  const bits = BigInt(raw);
  const names = Object.entries(PermissionsBitField.Flags)
    .filter(([, flag]) => flag !== 0n && (bits & flag) === flag)
    .map(([name]) => name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
  return names.join(', ') || 'n/a';
}

function warningPayload(message, text) {
  return {
    components: [textCard(`${EMOJI.WARNING} ${message.author}: ${text}`, 0xfed53c)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { repliedUser: false, parse: [] },
  };
}

async function getPrefix(guildId) {
  const cached = prefixCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.prefix;
  const guild = await ensureGuild(guildId);
  const prefix = normalizePrefix(guild.prefix);
  prefixCache.set(guildId, { prefix, expiresAt: Date.now() + CACHE_TTL_MS });
  return prefix;
}

/** Called by /prefix right after a successful change, so the new prefix takes effect immediately instead of waiting out the cache TTL. */
function setCachedPrefix(guildId, prefix) {
  prefixCache.set(guildId, { prefix: normalizePrefix(prefix), expiresAt: Date.now() + CACHE_TTL_MS });
}

function checkDefaultPermission(json, member) {
  if (json.default_member_permissions == null) return true;
  return member.permissions.has(BigInt(json.default_member_permissions));
}

function effectiveCommandData(command, argText) {
  const json = command.data.toJSON();
  const firstToken = tokenize(argText)[0]?.toLowerCase();
  const override = command.prefixPermissionOverrides?.[firstToken];
  if (override === undefined) return json;
  return { ...json, default_member_permissions: String(override) };
}

function containsArgumentVariable(value) {
  if (typeof value === 'string') return /\{(?:args(?:_raw)?|arguments|arg_count|arg\d{1,2}|args_from:\d{1,2})\}/i.test(value);
  if (Array.isArray(value)) return value.some((item) => containsArgumentVariable(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsArgumentVariable(item));
  return false;
}

/** Falls back here whenever `commandName` doesn't match a real command — tries a guild's admin-defined custom commands before giving up silently. */
async function runCustomCommand(message, commandName, argText = '', prefix = '!') {
  const row = await customCommandsDb.getCommand(message.guild.id, commandName).catch(() => null);
  // A command that has its own trigger is only set off by that trigger, not by the prefix of Petto.
  if (!row || (row.trigger_type && row.trigger_type !== 'command')) return false;
  return runCustomCommandRow(message, row, commandName, argText, prefix);
}

/** Runs a custom command that was already found: its code, its saved embed or its text. */
async function runCustomCommandRow(message, row, commandName, argText = '', prefix = '!', serverPrefix = prefix) {
  if (row.code) return runCodeCommand(message, row, argText, prefix, serverPrefix);
  message.channel.sendTyping().catch(() => {});

  const argTokens = tokenize(argText);
  const ctx = {
    member: message.member,
    guild: message.guild,
    channel: message.channel,
    message,
    args: argText,
    argTokens,
    commandName,
    prefix,
  };
  const { text: cleanedResponse, emojis: reactReplies } = extractReactReplies(row.response ?? '');
  const allowedMentions = { parse: [], users: [message.author.id], repliedUser: false };

  try {
    const doc = row.embed_template ? await getTemplate(message.guild.id, row.embed_template) : null;
    const needsArgs = containsArgumentVariable(row.response ?? '') || containsArgumentVariable(doc?.data);
    if (needsArgs && !argText.trim()) {
      const lang = (message.pettoLang ?? peekGuildLanguage(message.guild.id));
      await message.reply(warningPayload(message, t(lang, 'core.customCommand.needsText', { prefix, command: commandName }))).catch(() => {});
      return true;
    }

    if (doc) {
      const templateReactReplies = [];
      const templateData = extractReactRepliesFromTemplate(doc.data, templateReactReplies);
      const payload = await build(templateData, ctx);
      const sent = await message.reply({ content: payload.content, embeds: payload.embeds, components: payload.components, files: payload.files, allowedMentions }).catch(() => null);
      if (sent && (reactReplies.length || templateReactReplies.length)) await applyReactReplies(sent, [...reactReplies, ...templateReactReplies]);
      return true;
    }
    if (cleanedResponse) {
      const plain = await plainMessage(cleanedResponse, ctx);
      const sent = await message.reply({ ...plain, allowedMentions }).catch(() => null);
      if (sent && reactReplies.length) await applyReactReplies(sent, reactReplies);
    } else if (reactReplies.length) {
      await applyReactReplies(message, reactReplies);
    }
  } catch (err) {
    logger.error(`Failed to run custom command "${commandName}" in guild ${message.guild.id}:`, err);
  }
  return true;
}

/**
 * True when the message is a command for the bot: it starts with the server prefix (or an @mention of the bot) and the
 * first word is a command, an alias or a server alias. Other features use it to leave command messages alone, so a
 * word inside the command text does not set off an autoresponder.
 */
async function isCommandMessage(message) {
  if (!message.guild || typeof message.content !== 'string') return false;
  const botId = message.client.user?.id;
  const mention = botId ? [`<@${botId}>`, `<@!${botId}>`].find((p) => message.content.startsWith(p)) : null;
  const prefix = mention || await getPrefix(message.guild.id).catch(() => '!');
  let parsed = parsePrefixCommand(message.content, prefix);
  if (!parsed && !mention) {
    const own = await activeUserPrefix(message.client, message.author.id).catch(() => null);
    if (own) parsed = parsePrefixCommand(message.content, own);
  }
  if (!parsed) return false;
  const name = parsed.commandName;
  if (message.client.commands?.has(name) || message.client.commandAliases?.has(name) || message.client.commandRoutes?.has(name)) return true;
  const alias = await commandAliasesDb.get(message.guild.id, name).catch(() => null);
  return Boolean(alias);
}

module.exports = {
  name: Events.MessageCreate,
  isCommandMessage,
  setCachedPrefix,
  normalizePrefix,
  prefixMatches,
  parsePrefixCommand,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    // Always respond to an @mention prefix (no DB lookup needed) so a server can never
    // get locked out even if the configured custom prefix is forgotten or misconfigured.
    const mentionPrefixes = [`<@${message.client.user.id}>`, `<@!${message.client.user.id}>`];
    const mentionMatch = mentionPrefixes.find((p) => message.content.startsWith(p));

    const configuredPrefix = mentionMatch || await getPrefix(message.guild.id).catch(() => '!');
    let parsed = parsePrefixCommand(message.content, configuredPrefix);
    // A person with a prefix of their own (boosters, Premium, partners, the team) can use it anywhere, next to the server's.
    if (!parsed && !mentionMatch) {
      const own = await activeUserPrefix(message.client, message.author.id).catch(() => null);
      if (own) parsed = parsePrefixCommand(message.content, own);
    }
    if (!parsed) {
      // Not a command of Petto: it may still set off a custom command that has its own prefix or words.
      const trigger = await findTrigger(message.guild.id, message.content).catch(() => null);
      if (trigger) await runCustomCommandRow(message, trigger.row, trigger.row.name, trigger.args, trigger.prefix, mentionMatch ? '!' : configuredPrefix);
      return;
    }

    const prefix = parsed.typedPrefix;
    const lang = (message.pettoLang ?? peekGuildLanguage(message.guild.id));
    let commandName = parsed.commandName;
    let argText = parsed.argText;

    // Server-defined aliases are prefix-only, matching the rest of Petto's configurable
    // command surface. `{0}`, `{1}`, ... refer to arguments supplied after the alias.
    if (!message.client.commands.has(commandName) && !message.client.commandAliases.has(commandName) && !message.client.commandRoutes?.has(commandName)) {
      const configuredAlias = await commandAliasesDb.get(message.guild.id, commandName).catch(() => null);
      if (configuredAlias) {
        const targetTokens = tokenize(configuredAlias.command);
        const inputTokens = tokenize(argText);
        const expanded = targetTokens.flatMap((token) => {
          const match = /^\{(\d+)\}$/.exec(token);
          if (match) return inputTokens[Number(match[1])] === undefined ? [] : [inputTokens[Number(match[1])]];
          return [token.replace(/\{(\d+)\}/g, (_, index) => inputTokens[Number(index)] ?? '')];
        });
        commandName = (expanded.shift() ?? '').toLowerCase();
        argText = expanded.join(' ');
      }
    }

    // `!clear avatars|names|nicknames|all` deletes your saved history; `!clear 100` and the rest stay the channel's clear.
    if (commandName === 'clear' && /^(avatars?|names?|nicknames?|nicks?|all|history)(\s|$)/i.test(argText.trim())) {
      const what = argText.trim().split(/\s+/)[0].toLowerCase();
      commandName = 'profilehistory';
      argText = `clear ${/^avatar/.test(what) ? 'avatars' : /^name/.test(what) ? 'names' : /^nick/.test(what) ? 'nicknames' : 'all'}`;
    }

    const prefixRoute = message.client.commandRoutes?.get(commandName);
    if (prefixRoute) {
      // A route can send some first words elsewhere: `!forcenick list` is `!nickname forced`, `!forcenick @a b` is `!nickname force @a b`.
      const word = applyWordRoute(prefixRoute.words, prefixRoute.command, argText);
      commandName = prefixRoute.command;
      argText = word ? word.argText : [...prefixRoute.args, argText].filter(Boolean).join(' ');
    }

    let canonicalName = message.client.commandAliases.get(commandName) ?? commandName;
    let command = message.client.commands.get(canonicalName);
    // A command can send a first word to another command (`!timeout list` is `!mute list`, `!hardban list` is `!ban list hard`).
    const wordRoute = command ? applyWordRoute(command.prefixWords, canonicalName, argText) : null;
    if (wordRoute) {
      canonicalName = message.client.commandAliases.get(wordRoute.commandName) ?? wordRoute.commandName;
      command = message.client.commands.get(canonicalName);
      argText = wordRoute.argText;
    }
    // Shorter ways of writing a command (`!purge bots 50`), turned into its usual form before it is read.
    if (typeof command?.prefixArgs === 'function') argText = command.prefixArgs(argText);
    const automodControlAction = canonicalName === 'automod' ? controlAction(argText) : null;
    const hiddenAutomodControl = Boolean(automodControlAction && automodControlAction !== 'invalid');
    if (hiddenAutomodControl) argText = `control ${automodControlAction}`;
    // Slash-only commands can open native Discord modals and must not be
    // executed through the pseudo-interaction used by prefix commands.
    if (command?.slashOnly) return;
    if (!command || !command.data || (command.data.toJSON().type ?? 1) !== 1) {
      let handled = await runCustomCommand(message, canonicalName, argText, prefix);
      if (!handled) {
        // A prefix of its own that starts like the prefix of Petto, such as !! next to !
        const trigger = await findTrigger(message.guild.id, message.content).catch(() => null);
        if (trigger) { await runCustomCommandRow(message, trigger.row, trigger.row.name, trigger.args, trigger.prefix, mentionMatch ? '!' : configuredPrefix); handled = true; }
      }
      if (!handled) {
        const warning = await message
          .reply({ components: [textCard(t(lang, 'core.unknownCommand', { emoji: EMOJI.WARNING, command: canonicalName, prefix }), 0xfed53c)], flags: MessageFlags.IsComponentsV2, allowedMentions: { repliedUser: false } })
          .catch(() => null);
        // Matches bli: the "unknown command" nudge clears itself out instead of cluttering chat.
        if (warning) setTimeout(() => warning.delete().catch(() => {}), UNKNOWN_COMMAND_DELETE_MS);
      }
      return;
    }

    const disabled = hiddenAutomodControl ? null : await disabledDb.findCached(message.guild.id, canonicalName, message.channel.id).catch(() => null);
    if (disabled) {
      const text = disabled.channel_id
        ? t(lang, 'core.disabled.channel', { command: canonicalName, channel: `<#${disabled.channel_id}>` })
        : t(lang, 'core.disabled.server', { command: canonicalName });
      await message.reply(warningPayload(message, text)).catch(() => {});
      return;
    }

    // Real command, actually going to run now — the "Bot is typing..." indicator is the only
    // feedback a message-based command can give before its reply lands, so fire it as early as
    // possible instead of leaving the channel silent through cooldown/permission/arg-parsing
    // checks and the command's own DB/Discord API calls.
    message.channel.sendTyping().catch(() => {});

    const cooldownMs = command.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const remaining = await getRemainingCooldownShared(canonicalName, message.author.id, cooldownMs);
    if (remaining > 0) {
      await message.reply(warningPayload(message, t(lang, 'core.cooldown', { seconds: formatDecimal(lang, remaining / 1000), prefix, command: canonicalName }))).catch(() => {});
      return;
    }

    let moderationRoleOverride = false;
    if (command.category === 'moderation') {
      moderationRoleOverride = await moderationPermissions.hasConfiguredRole(message.guild.id, canonicalName, message.member).catch((err) => {
        logger.error('Error checking configured moderation role:', err);
        return false;
      });
    }

    const permissionData = effectiveCommandData(command, argText);
    if (!hiddenAutomodControl && !moderationRoleOverride && !checkDefaultPermission(permissionData, message.member)) {
      await message.reply(warningPayload(message, t(lang, 'core.missingPermission', { permission: permissionKey(permissionData) }))).catch(() => {});
      return;
    }

    try {
      const allowed = hiddenAutomodControl || moderationRoleOverride || await permissionsDb.hasCommandPermission(message.guild.id, canonicalName, message.member);
      if (!allowed) {
        await message.reply(warningPayload(message, t(lang, 'core.missingLevel', { prefix, command: canonicalName }))).catch(() => {});
        return;
      }
    } catch (err) {
      logger.error('Error checking custom command permission level:', err);
    }

    // !restrictcommand: only the roles chosen for this command (administrators always can).
    const restricted = hiddenAutomodControl ? null : await restrictedFor(message.guild.id, canonicalName, message.member).catch((err) => {
      logger.error('Error checking restricted command:', err);
      return null;
    });
    if (restricted) {
      await message.reply(warningPayload(message, t(lang, 'core.restricted', { command: canonicalName, roles: restricted.map((id) => `<@&${id}>`).join(', ') }))).catch(() => {});
      return;
    }

    let interaction;
    try {
      interaction = await buildInteractionFromMessage(message, command, argText);
    } catch (err) {
      // Something specific that the parser said (a role that was not found...) is told as it is; a missing option, or a way of
      // writing it that cannot be read, gets a card with how to write it.
      if (err.userFacing && !err.missingOption) {
        await message.reply(warningPayload(message, err.message)).catch(() => {});
        return;
      }
      await message.reply(missingOptionCard({ command, prefix, name: canonicalName, argText, missing: err.missingOption ?? null, lang })).catch(() => {});
      return;
    }

    if (!interaction) {
      await message.reply(unknownSubcommandCard({ command, prefix, name: canonicalName, typed: tokenize(argText)[0] ?? '', lang })).catch(() => {});
      return;
    }

    interaction.typedPrefix = prefix;
    // The language of the server, found once here so the command does not look it up again.
    interaction.pettoLang = lang;
    interaction.pettoModerationRoleAllowed = moderationRoleOverride;
    interaction.pettoAutomodControl = hiddenAutomodControl;

    // The `commands` log category: the name of the command only, and only when a channel is set for it.
    if (!hiddenAutomodControl) logCommandUse({ guild: message.guild, user: message.author, channel: message.channel, name: canonicalName, prefix, subcommand: interaction.options.getSubcommand(false) }, message.client);

    try {
      await command.execute(interaction, message.client);
    } catch (err) {
      // A missing permission is the server's to fix: it is told in plain words and kept out of the channel of errors.
      // Something the member did (a missing argument...) is not a bug: it is told to them, with how to write it, and kept out of the error channel.
      if (isPermissionError(err)) logger.warn(`Missing permission running ${prefix}${canonicalName}: ${err.message} (code ${err.code})`);
      else if (err.userFacing) logger.info(`${prefix}${canonicalName}: ${err.message}`);
      else logger.error(`Error executing ${prefix}${canonicalName}:`, err);
      const errorReply = err.missingOption
        ? missingOptionCard({ command, prefix, name: canonicalName, argText, missing: err.missingOption, lang })
        : warningPayload(message, err.userFacing ? err.message : isPermissionError(err) ? permissionHelp(err, lang) : t(lang, 'core.error'));
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorReply).catch(() => {});
      else await interaction.reply(errorReply).catch(() => {});
    }
  },
};
