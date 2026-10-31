const { isPermissionError, permissionHelp } = require('../utils/permissionErrors');
const { isPayloadError } = require('../utils/payloadFallback');
const { Events, MessageFlags, PermissionsBitField } = require('discord.js');
const { plainMessage } = require('../utils/cardService');
const { ensureGuild } = require('../db/guilds');
const { buildInteractionFromMessage, tokenize } = require('../handlers/prefixInteraction');
const { unknownSubcommandCard, missingOptionCard } = require('../utils/usageCard');
const commandAliasesDb = require('../db/commandAliases');
const { getRemainingCooldownShared } = require('../utils/sharedCooldown');
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
const { applyWordRoute } = require('../utils/commandRestrictions');
const commandRules = require('../utils/commandRules');
const logger = require('../utils/logger');
const { logCommandUse } = require('../logging/extraLog');
const { runCodeCommand } = require('../utils/codeCommands');
const { findTrigger } = require('../utils/codeTriggers');
const { peekGuildLanguage, t, formatDecimal } = require('../i18n');
const guildPrefixes = require('../utils/guildPrefixes');
const { isCommonWord } = require('../utils/commonWords');
// Loaded when a message comes in: it reaches for the configuration and the database, which the checks do without.
const activeUserPrefix = async (...args) => require('../utils/userPrefixAccess').activeUserPrefix(...args);

const DEFAULT_COOLDOWN_MS = 3000;
const UNKNOWN_COMMAND_DELETE_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const prefixCache = new Map(); // guildId -> { prefixes, expiresAt }

function normalizePrefix(prefix) {
  const value = typeof prefix === 'string' ? prefix.trim() : '';
  return value || '!';
}

/** A prefix, a list of them or a server row as a clean list (never empty: `!` is the last resort). */
function normalizePrefixes(value) {
  if (Array.isArray(value)) {
    const list = guildPrefixes.prefixesOf({ prefixes: value });
    return list;
  }
  if (value && typeof value === 'object') return guildPrefixes.prefixesOf(value);
  return [normalizePrefix(value)];
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

/** `color` null: the same card with no colored side bar (the "command is turned off" notice). */
function warningPayload(message, text, color = 0xfed53c) {
  return {
    components: [textCard(`${EMOJI.WARNING} ${message.author}: ${text}`, color)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { repliedUser: false, parse: [] },
  };
}

/** The prefixes of a server, the main one first. */
async function getPrefixes(guildId) {
  const cached = prefixCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.prefixes;
  const guild = await ensureGuild(guildId);
  const prefixes = normalizePrefixes(guild);
  prefixCache.set(guildId, { prefixes, expiresAt: Date.now() + CACHE_TTL_MS });
  return prefixes;
}

/** The main prefix of a server (the first of its list). */
async function getPrefix(guildId) {
  return (await getPrefixes(guildId))[0];
}

/** Called by !prefix and the dashboard right after a successful change (one prefix or the whole list), so it takes effect immediately instead of waiting out the cache TTL. */
function setCachedPrefix(guildId, prefixes) {
  prefixCache.set(guildId, { prefixes: normalizePrefixes(prefixes), expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Whether a word is something Petto answers in this server: a command, an alias, a route, a server alias or a custom command
 * that starts with the prefix. A word prefix (`petto help`) only starts a command when this is true.
 */
function knownNameChecker(client, guildId) {
  return async (name) => {
    if (client.commands?.has(name)) return true;
    // An everyday word (`is`, `si`, `um`) that is also a short alias is a command with a symbol prefix (`!is`) but chat after a word
    // prefix: `petto is the best` is not `!image sepia`. A server alias or a custom command was chosen by the server, so it stays.
    if (client.commandAliases?.has(name) || client.commandRoutes?.has(name)) return !isCommonWord(name);
    if (await commandAliasesDb.get(guildId, name).catch(() => null)) return true;
    const row = await customCommandsDb.getCommand(guildId, name).catch(() => null);
    return Boolean(row && (!row.trigger_type || row.trigger_type === 'command'));
  };
}

/** Whether the server has an alias or a custom command with this word (they win over the short aliases, which are Petto's own). */
async function serverUsesWord(guildId, name) {
  if (await commandAliasesDb.get(guildId, name).catch(() => null)) return true;
  const row = await customCommandsDb.getCommand(guildId, name).catch(() => null);
  return Boolean(row && (!row.trigger_type || row.trigger_type === 'command'));
}

/**
 * How a message starts a command, or null: an @mention of the bot (always works), or a prefix of the server (any of its list) or the
 * personal prefix of the author. See guildPrefixes.matchPrefix for the rules; `main` and `word` tell if an unknown word may be answered.
 */
async function findPrefixWay(message) {
  const botId = message.client.user?.id;
  const mention = botId ? [`<@${botId}>`, `<@!${botId}>`].find((p) => message.content.startsWith(p)) : null;
  if (mention) {
    const parsed = parsePrefixCommand(message.content, mention);
    return parsed ? { ...parsed, source: 'mention', main: true, word: false, mention: true } : null;
  }
  const prefixes = await getPrefixes(message.guild.id).catch(() => ['!']);
  const personal = await activeUserPrefix(message.client, message.author.id).catch(() => null);
  const way = await guildPrefixes.matchPrefix(message.content, { prefixes, personal, isKnown: knownNameChecker(message.client, message.guild.id) });
  return way ? { ...way, mention: false } : null;
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
  const parsed = await findPrefixWay(message);
  if (!parsed) return false;
  const name = parsed.commandName;
  if (message.client.commands?.has(name) || message.client.commandAliases?.has(name) || message.client.commandRoutes?.has(name)) return true;
  const alias = await commandAliasesDb.get(message.guild.id, name).catch(() => null);
  return Boolean(alias);
}

module.exports = {
  name: Events.MessageCreate,
  isCommandMessage,
  knownNameChecker,
  setCachedPrefix,
  getPrefixes,
  normalizePrefix,
  prefixMatches,
  parsePrefixCommand,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    // An @mention of the bot always works, so a server can never get locked out if it forgets its prefixes. Then the prefixes of the
    // server (any of the list, the longest first) and the personal one of the author (boosters, Premium, partners, the team).
    const parsed = await findPrefixWay(message);
    const mainPrefix = await getPrefix(message.guild.id).catch(() => '!');
    if (!parsed) {
      // Not a command of Petto: it may still set off a custom command that has its own prefix or words.
      const trigger = await findTrigger(message.guild.id, message.content).catch(() => null);
      if (trigger) await runCustomCommandRow(message, trigger.row, trigger.row.name, trigger.args, trigger.prefix, mainPrefix);
      return;
    }

    const prefix = parsed.typedPrefix;
    const lang = (message.pettoLang ?? peekGuildLanguage(message.guild.id));
    let commandName = parsed.commandName;
    let argText = parsed.argText;

    // Server-defined aliases are prefix-only, matching the rest of Petto's configurable
    // command surface. `{0}`, `{1}`, ... refer to arguments supplied after the alias.
    // A short alias (`!is`) never takes a word from the server: an alias or a custom command the server wrote with that word wins.
    const shortRoute = message.client.commandRoutes?.get(commandName)?.short ? message.client.commandRoutes.get(commandName) : null;
    const serverOwnsIt = shortRoute ? await serverUsesWord(message.guild.id, commandName) : false;
    if (serverOwnsIt || (!message.client.commands.has(commandName) && !message.client.commandAliases.has(commandName) && !message.client.commandRoutes?.has(commandName))) {
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

    // `!clear names|nicknames|all` deletes your saved history; `!clear 100` and the rest stay the channel's clear.
    if (commandName === 'clear' && /^(names?|nicknames?|nicks?|all|history)(\s|$)/i.test(argText.trim())) {
      const what = argText.trim().split(/\s+/)[0].toLowerCase();
      commandName = 'profilehistory';
      argText = `clear ${/^name/.test(what) ? 'names' : /^nick/.test(what) ? 'nicknames' : 'all'}`;
    }

    const prefixRoute = serverOwnsIt ? undefined : message.client.commandRoutes?.get(commandName);
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
        if (trigger) { await runCustomCommandRow(message, trigger.row, trigger.row.name, trigger.args, trigger.prefix, mainPrefix); handled = true; }
      }
      // Only the main prefix of the server answers "I don't know that command", and only to something written like a command
      // (`!es el mejor`). The other prefixes, the word ones (`petto es el mejor`), the personal one and a lone symbol are chat.
      if (!handled && (parsed.mention || guildPrefixes.answersUnknown(parsed))) {
        const warning = await message
          .reply({ components: [textCard(t(lang, 'core.unknownCommand', { emoji: EMOJI.WARNING, command: canonicalName, prefix }))], flags: MessageFlags.IsComponentsV2, allowedMentions: { repliedUser: false } })
          .catch(() => null);
        // Matches bli: the "unknown command" nudge clears itself out instead of cluttering chat.
        if (warning) setTimeout(() => warning.delete().catch(() => {}), UNKNOWN_COMMAND_DELETE_MS);
      }
      return;
    }

    // A route can stand for one action of a command (`!hug` is `/act` hug): `!disablecommand hug` turns off that action only, and
    // turning off the whole command (`!disablecommand act`, or its category) turns off every action too. The slash command asks
    // the same function (utils/commandRules.js).
    const ruleNames = commandRules.ruleNames(command, { route: prefixRoute, subcommand: commandRules.subcommandOfText(command, argText) });
    const found = hiddenAutomodControl ? null : await commandRules.disabledFor(message.guild.id, ruleNames, message.channel.id);
    const disabled = found?.row ?? null;
    const disableName = found?.name ?? canonicalName;
    if (disabled) {
      // The usual warning card (the warning icon and who asked) with no colored side bar, that clears itself out like the
      // "unknown command" one. The icon comes from warningPayload, so the text goes without its own.
      const text = disabled.channel_id
        ? t(lang, 'core.disabled.channel', { emoji: '', command: `${prefix}${disableName}`, channel: `<#${disabled.channel_id}>` })
        : t(lang, 'core.disabled.server', { emoji: '', command: `${prefix}${disableName}` });
      const notice = await message.reply(warningPayload(message, text.trim(), null)).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), UNKNOWN_COMMAND_DELETE_MS);
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
    const restricted = hiddenAutomodControl ? null : await commandRules.restrictedForNames(message.guild.id, ruleNames, message.member).catch((err) => {
      logger.error('Error checking restricted command:', err);
      return null;
    });
    if (restricted) {
      await message.reply(warningPayload(message, t(lang, 'core.restricted', { command: restricted.name, roles: restricted.roles.map((id) => `<@&${id}>`).join(', ') }))).catch(() => {});
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
        : warningPayload(message, err.userFacing ? err.message : isPermissionError(err) ? permissionHelp(err, lang) : isPayloadError(err) ? t(lang, 'core.replyTooLong') : t(lang, 'core.error'));
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorReply).catch(() => {});
      else await interaction.reply(errorReply).catch(() => {});
    }
  },
};
