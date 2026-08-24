const { ApplicationCommandOptionType, MessageFlags } = require('discord.js');
const ms = require('ms');
const { resolveRole } = require('../utils/roleResolve');
const { resolveUser } = require('../utils/userResolve');

// ── Tokenizing ───────────────────────────────────────────────────────────────

/** Splits a command's argument text into tokens, treating "quoted strings" and 'single-quoted' as one token each. */
function tokenize(content) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(content))) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

// ── Resolving the subcommand/group + its option definitions ────────────────

/**
 * Walks a command's `.data.toJSON()` shape to find which (sub)command the first
 * one or two tokens select, returning its declared options (still ordered
 * required-first, same as Discord enforces when the SlashCommandBuilder was built)
 * and the remaining tokens meant for those options. Returns null if the tokens
 * don't match any known subcommand (caller should show usage/help).
 */
function resolveSubcommandOptions(json, tokens) {
  const topOptions = json.options ?? [];
  const hasSub = topOptions.some((o) => o.type === ApplicationCommandOptionType.Subcommand || o.type === ApplicationCommandOptionType.SubcommandGroup);

  if (!hasSub) {
    return { subcommand: null, subcommandGroup: null, optionDefs: topOptions, remainingTokens: tokens };
  }

  const first = tokens[0]?.toLowerCase();
  const groupEntry = topOptions.find((o) => o.type === ApplicationCommandOptionType.SubcommandGroup && o.name === first);

  if (groupEntry) {
    const second = tokens[1]?.toLowerCase();
    const subEntry = groupEntry.options?.find((o) => o.type === ApplicationCommandOptionType.Subcommand && o.name === second);
    if (!subEntry) return null;
    return { subcommand: subEntry.name, subcommandGroup: groupEntry.name, optionDefs: subEntry.options ?? [], remainingTokens: tokens.slice(2) };
  }

  const subEntry = topOptions.find((o) => o.type === ApplicationCommandOptionType.Subcommand && o.name === first);
  if (subEntry) {
    return { subcommand: subEntry.name, subcommandGroup: null, optionDefs: subEntry.options ?? [], remainingTokens: tokens.slice(1) };
  }

  return null;
}

// ── Token -> typed value conversion ─────────────────────────────────────────

const SNOWFLAKE_RE = /^\d{15,25}$/;
const MENTION_OR_ID_RE = /^(<@!?\d+>|<@&\d+>|<#\d+>|\d{15,25})$/;
// Broader than MENTION_OR_ID_RE (any-length \d+, not just snowflakes) — for options that are
// genuinely lists of short tokens (case/warn numbers), not just mentions/IDs.
const LIST_TOKEN_RE = /^(<@!?\d+>|<@&\d+>|<#\d+>|\d+)$/;
const LIST_OPTION_NAMES = new Set(['users', 'roles', 'cases', 'channels']);

function resolveRoleToken(guild, token) {
  return resolveRole(guild, token);
}

function resolveChannelToken(guild, token) {
  if (!token) return null;
  const channelName = token.startsWith('#') ? token.slice(1) : token;
  const id = channelName.replace(/[<#>]/g, '');
  if (SNOWFLAKE_RE.test(id)) return guild.channels.cache.get(id) ?? null;
  return guild.channels.cache.find((c) => c.name.toLowerCase() === channelName.toLowerCase()) ?? null;
}

function parseBoolToken(token) {
  if (!token) return null;
  const t = token.toLowerCase();
  if (['true', 'on', 'yes', 'enable', 'enabled', '1'].includes(t)) return true;
  if (['false', 'off', 'no', 'disable', 'disabled', '0'].includes(t)) return false;
  return null;
}

/** Converts one raw token into the value type a given option definition expects, or null if it doesn't fit. */
async function convertToken(message, def, token, resolveContext = {}) {
  if (token === undefined) return null;
  switch (def.type) {
    case ApplicationCommandOptionType.User:
      return resolveUser(message.client, token, message.guild, resolveContext);
    case ApplicationCommandOptionType.Role:
      return resolveRoleToken(message.guild, token);
    case ApplicationCommandOptionType.Channel:
      return resolveChannelToken(message.guild, token);
    case ApplicationCommandOptionType.Integer:
    case ApplicationCommandOptionType.Number: {
      const n = Number(token);
      return Number.isNaN(n) ? null : n;
    }
    case ApplicationCommandOptionType.Boolean:
      return parseBoolToken(token);
    case ApplicationCommandOptionType.String:
    default:
      return token;
  }
}

// ── `--flag value` extraction (escape hatch for commands with several adjacent optional strings, e.g. /ticket category add) ──

const FLAG_RE = /^--([a-z_]+)$/i;

async function extractFlags(message, tokens, optionDefs, resolveContext) {
  const defByName = new Map(optionDefs.map((d) => [d.name, d]));
  const remaining = [];
  const flagValues = {};

  for (let i = 0; i < tokens.length; i++) {
    const match = FLAG_RE.exec(tokens[i]);
    const def = match && defByName.get(match[1].toLowerCase());
    if (def && tokens[i + 1] !== undefined) {
      const value = await convertToken(message, def, tokens[i + 1], resolveContext);
      if (value !== null) {
        flagValues[def.name] = value;
        i++;
        continue;
      }
    }
    remaining.push(tokens[i]);
  }

  return { remaining, flagValues };
}

// ── Positional parsing of whatever's left after flags are pulled out ───────

/**
 * Fills option values positionally, in the order Discord already requires (required
 * options before optional ones). Non-last STRING options greedily consume consecutive
 * mention/ID-shaped tokens (covers "users"/"roles"-style multi-target lists); otherwise
 * they fall back to a single token, so a multi-word value needs "quotes" unless it's the
 * command's final option (which always consumes every remaining token as free text).
 * Optional User/Role/Channel/Integer/Boolean tokens that don't fit their slot are left
 * for the next option instead of being force-consumed, so skipping an optional works
 * as long as what follows unambiguously resolves to a different type.
 */
async function parsePositional(message, optionDefs, tokens, resolveContext) {
  const values = {};
  let i = 0;

  for (let idx = 0; idx < optionDefs.length; idx++) {
    const def = optionDefs[idx];
    const isLast = idx === optionDefs.length - 1;
    // Only reserve room for options after this one that are actually required — an optional
    // one can simply end up unset if the message runs out of tokens, same as slash commands.
    const defsAfter = optionDefs.slice(idx + 1).filter((d) => d.required).length;
    if (i >= tokens.length) continue;

    if (def.type === ApplicationCommandOptionType.String) {
      if (isLast) {
        values[def.name] = tokens.slice(i).join(' ');
        i = tokens.length;
        continue;
      }

      // "duration" is the other common non-last optional string (e.g. /case edit <case> [duration] [reason])
      // — validate its shape instead of blindly grabbing a token, so a quoted reason meant for a later
      // slot doesn't get misread as the duration and vice versa.
      if (def.name === 'duration') {
        if (typeof ms(tokens[i]) === 'number') {
          values[def.name] = tokens[i];
          i++;
        }
        continue;
      }

      const listRe = LIST_OPTION_NAMES.has(def.name) ? LIST_TOKEN_RE : MENTION_OR_ID_RE;
      const consumed = [];
      while (i < tokens.length && listRe.test(tokens[i]) && tokens.length - i > defsAfter) {
        consumed.push(tokens[i]);
        i++;
      }
      if (!consumed.length) {
        consumed.push(tokens[i]);
        i++;
      }
      values[def.name] = consumed.join(' ');
      continue;
    }

    const value = await convertToken(message, def, tokens[i], resolveContext);
    if (value !== null) {
      values[def.name] = value;
      i++;
    }
  }

  return values;
}

async function parseOptions(message, optionDefs, tokens, resolveContext) {
  const { remaining, flagValues } = await extractFlags(message, tokens, optionDefs, resolveContext);
  const unfilledDefs = optionDefs.filter((d) => !(d.name in flagValues));
  const positionalValues = await parsePositional(message, unfilledDefs, remaining, resolveContext);
  return { ...flagValues, ...positionalValues };
}

// ── Pseudo-interaction: lets existing command execute(interaction) functions run unchanged ──

function missingArgError(name) {
  const err = new Error(`Missing required argument: \`${name}\`. Check the command's usage.`);
  err.userFacing = true;
  return err;
}

function getOpt(values, name, required) {
  const v = values[name];
  if (v === undefined || v === null) {
    if (required) throw missingArgError(name);
    return null;
  }
  return v;
}

/** Strips the Ephemeral flag (meaningless for a plain message reply) while preserving everything else, e.g. IsComponentsV2. */
function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.flags !== 'number') return payload;
  const flags = payload.flags & ~MessageFlags.Ephemeral;
  return { ...payload, flags: flags || undefined };
}

/**
 * Builds an object shaped enough like a discord.js ChatInputCommandInteraction that
 * every existing command's execute(interaction) runs unmodified: same .options.getX(),
 * .member/.guild/.user/.client/.channel, and reply()/deferReply()/editReply()/followUp()
 * — reply()/editReply() both just resolve to a real message send under the hood, since a
 * prefix command has no 3-second ack window or ephemeral concept to route around.
 */
function buildPseudoInteraction(message, { commandName, subcommand, subcommandGroup, values }) {
  let repliedMessage = null;
  let deferredFlag = false;

  return {
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    commandName,
    guild: message.guild,
    guildId: message.guild.id,
    channel: message.channel,
    channelId: message.channel.id,
    member: message.member,
    user: message.author,
    client: message.client,
    // The real discord.js Message driving this command — real slash interactions have no
    // equivalent (nothing they're "in reply to"), but a few prefix-only commands genuinely
    // need it (e.g. /steal reading message.reference/message.stickers for a replied-to sticker).
    rawMessage: message,
    options: {
      getSubcommand: (required = true) => {
        if (!subcommand && required) throw missingArgError('subcommand');
        return subcommand;
      },
      getSubcommandGroup: (required = false) => {
        if (!subcommandGroup && required) throw missingArgError('subcommand group');
        return subcommandGroup ?? null;
      },
      getString: (name, required) => getOpt(values, name, required),
      getInteger: (name, required) => getOpt(values, name, required),
      getNumber: (name, required) => getOpt(values, name, required),
      getBoolean: (name, required) => getOpt(values, name, required),
      getUser: (name, required) => getOpt(values, name, required),
      getRole: (name, required) => getOpt(values, name, required),
      getChannel: (name, required) => getOpt(values, name, required),
      getMentionable: (name, required) => getOpt(values, name, required),
    },
    get deferred() {
      return deferredFlag;
    },
    get replied() {
      return repliedMessage !== null;
    },
    async deferReply() {
      deferredFlag = true;
    },
    async reply(payload) {
      repliedMessage = await message.reply(sanitizePayload(payload));
      return repliedMessage;
    },
    async editReply(payload) {
      if (repliedMessage) return repliedMessage.edit(sanitizePayload(payload));
      repliedMessage = await message.channel.send(sanitizePayload(payload));
      return repliedMessage;
    },
    async followUp(payload) {
      return message.channel.send(sanitizePayload(payload));
    },
    async fetchReply() {
      return repliedMessage;
    },
  };
}

/**
 * End-to-end: given a loaded command (with its original SlashCommandBuilder `.data`
 * still attached, used purely for introspection here — nothing about it gets deployed
 * to Discord anymore) and the raw text typed after the prefix, returns a ready-to-call
 * pseudo-interaction, or null if the subcommand didn't match anything declared.
 */
async function buildInteractionFromMessage(message, command, argText) {
  const tokens = tokenize(argText);
  const json = command.data.toJSON();
  const subcommandAliases = command.prefixSubcommandAliases ?? {};
  const normalizedTokens = [...tokens];
  if (normalizedTokens[0]) {
    normalizedTokens[0] = subcommandAliases[normalizedTokens[0].toLowerCase()] ?? normalizedTokens[0];
  }

  const resolved = resolveSubcommandOptions(json, normalizedTokens) ?? (
    command.prefixDefaultSubcommand
      ? resolveSubcommandOptions(json, [command.prefixDefaultSubcommand, ...normalizedTokens])
      : null
  );
  if (!resolved) return null;

  const values = await parseOptions(message, resolved.optionDefs, resolved.remainingTokens, {
    includeBans: json.name === 'unban' || (json.name === 'ban' && resolved.subcommand === 'remove'),
  });
  return buildPseudoInteraction(message, { commandName: json.name, subcommand: resolved.subcommand, subcommandGroup: resolved.subcommandGroup, values });
}

module.exports = { tokenize, resolveSubcommandOptions, parseOptions, buildPseudoInteraction, buildInteractionFromMessage };
