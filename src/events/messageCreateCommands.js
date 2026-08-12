const { Events, MessageFlags, PermissionsBitField } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { buildInteractionFromMessage, tokenize } = require('../handlers/prefixInteraction');
const commandAliasesDb = require('../db/commandAliases');
const { getRemainingCooldown } = require('../utils/cooldown');
const disabledDb = require('../db/disabledCommands');
const permissionsDb = require('../db/permissions');
const customCommandsDb = require('../db/customCommands');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('../utils/embedBuilder');
const { resolve } = require('../utils/embedVariables');
const { extractReactReplies, applyReactReplies } = require('../utils/messageFlags');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const moderationPermissions = require('../utils/moderationPermissions');
const { controlAction } = require('../utils/autoModControl');
const logger = require('../utils/logger');

const DEFAULT_COOLDOWN_MS = 3000;
const UNKNOWN_COMMAND_DELETE_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const prefixCache = new Map(); // guildId -> { prefix, expiresAt }

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

function commandUsage(command, prefix) {
  const json = command.data.toJSON();
  const hidden = new Set(command.hiddenPrefixSubcommands ?? []);
  const options = json.options ?? [];
  const subcommands = options
    .map((option) => {
      if (option.type === 1) return hidden.has(option.name) ? null : option.name;
      if (option.type !== 2) return null;
      const children = option.options?.filter((child) => child.type === 1 && !hidden.has(`${option.name} ${child.name}`)).map((child) => child.name) ?? [];
      return children.length ? `${option.name} ${children.join(' | ')}` : null;
    })
    .filter(Boolean);
  return subcommands.length ? `${prefix}${json.name} ${subcommands.join(' | ')}` : `${prefix}${json.name}`;
}

async function getPrefix(guildId) {
  const cached = prefixCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.prefix;
  const guild = await ensureGuild(guildId);
  prefixCache.set(guildId, { prefix: guild.prefix, expiresAt: Date.now() + CACHE_TTL_MS });
  return guild.prefix;
}

/** Called by /prefix right after a successful change, so the new prefix takes effect immediately instead of waiting out the cache TTL. */
function setCachedPrefix(guildId, prefix) {
  prefixCache.set(guildId, { prefix, expiresAt: Date.now() + CACHE_TTL_MS });
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

/** Falls back here whenever `commandName` doesn't match a real command — tries a guild's admin-defined custom commands before giving up silently. */
async function runCustomCommand(message, commandName) {
  const row = await customCommandsDb.getCommand(message.guild.id, commandName).catch(() => null);
  if (!row) return false;
  message.channel.sendTyping().catch(() => {});

  const ctx = { member: message.member, guild: message.guild, channel: message.channel, message };
  const { text: cleanedResponse, emojis: reactReplies } = extractReactReplies(row.response ?? '');

  try {
    if (row.embed_template) {
      const doc = await getTemplate(message.guild.id, row.embed_template);
      if (doc) {
        const payload = await build(doc.data, ctx);
        const sent = await message.reply({ content: payload.content, embeds: payload.embeds, components: payload.components }).catch(() => null);
        if (sent && reactReplies.length) await applyReactReplies(sent, reactReplies);
        return true;
      }
    }
    if (cleanedResponse) {
      const resolved = await resolve(cleanedResponse, ctx);
      const sent = await message.reply(resolved).catch(() => null);
      if (sent && reactReplies.length) await applyReactReplies(sent, reactReplies);
    } else if (reactReplies.length) {
      await applyReactReplies(message, reactReplies);
    }
  } catch (err) {
    logger.error(`Failed to run custom command "${commandName}" in guild ${message.guild.id}:`, err);
  }
  return true;
}

module.exports = {
  name: Events.MessageCreate,
  setCachedPrefix,
  async execute(message) {
    if (message.author.bot || !message.guild) return;

    // Always respond to an @mention prefix (no DB lookup needed) so a server can never
    // get locked out even if the configured custom prefix is forgotten or misconfigured.
    const mentionPrefixes = [`<@${message.client.user.id}>`, `<@!${message.client.user.id}>`];
    const mentionMatch = mentionPrefixes.find((p) => message.content.startsWith(p));

    let prefix = mentionMatch;
    if (!prefix) {
      const configuredPrefix = await getPrefix(message.guild.id).catch(() => '!');
      if (!message.content.startsWith(configuredPrefix)) return;
      prefix = configuredPrefix;
    }

    const withoutPrefix = message.content.slice(prefix.length).trim();
    if (!withoutPrefix) return;

    const spaceIdx = withoutPrefix.indexOf(' ');
    let commandName = (spaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, spaceIdx)).toLowerCase();
    let argText = spaceIdx === -1 ? '' : withoutPrefix.slice(spaceIdx + 1);

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

    const prefixRoute = message.client.commandRoutes?.get(commandName);
    if (prefixRoute) {
      commandName = prefixRoute.command;
      argText = [...prefixRoute.args, argText].filter(Boolean).join(' ');
    }

    const canonicalName = message.client.commandAliases.get(commandName) ?? commandName;
    const command = message.client.commands.get(canonicalName);
    const automodControlAction = canonicalName === 'automod' ? controlAction(argText) : null;
    const hiddenAutomodControl = Boolean(automodControlAction && automodControlAction !== 'invalid');
    if (hiddenAutomodControl) argText = `control ${automodControlAction}`;
    // Slash-only commands can open native Discord modals and must not be
    // executed through the pseudo-interaction used by prefix commands.
    if (command?.slashOnly) return;
    if (!command || !command.data || (command.data.toJSON().type ?? 1) !== 1) {
      const handled = await runCustomCommand(message, canonicalName);
      if (!handled) {
        const warning = await message
          .reply({ components: [textCard(`${EMOJI.WARNING}  Unknown command \`${canonicalName}\`. Use \`${prefix}help\` to see all commands.`, 0xfed53c)], flags: MessageFlags.IsComponentsV2, allowedMentions: { repliedUser: false } })
          .catch(() => null);
        // Matches bli: the "unknown command" nudge clears itself out instead of cluttering chat.
        if (warning) setTimeout(() => warning.delete().catch(() => {}), UNKNOWN_COMMAND_DELETE_MS);
      }
      return;
    }

    const disabled = hiddenAutomodControl ? null : await disabledDb.findCached(message.guild.id, canonicalName, message.channel.id).catch(() => null);
    if (disabled) {
      const scope = disabled.channel_id ? `in <#${disabled.channel_id}>` : 'on this server';
      await message.reply(warningPayload(message, `Command \`${canonicalName}\` is disabled ${scope}.`)).catch(() => {});
      return;
    }

    // Real command, actually going to run now — the "Bot is typing..." indicator is the only
    // feedback a message-based command can give before its reply lands, so fire it as early as
    // possible instead of leaving the channel silent through cooldown/permission/arg-parsing
    // checks and the command's own DB/Discord API calls.
    message.channel.sendTyping().catch(() => {});

    const cooldownMs = command.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const remaining = getRemainingCooldown(canonicalName, message.author.id, cooldownMs);
    if (remaining > 0) {
      await message.reply(warningPayload(message, `Please wait ${(remaining / 1000).toFixed(1)}s before using \`${prefix}${canonicalName}\` again.`)).catch(() => {});
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
      await message.reply(warningPayload(message, `You're missing permission: \`${permissionKey(permissionData)}\`.`)).catch(() => {});
      return;
    }

    try {
      const allowed = hiddenAutomodControl || moderationRoleOverride || await permissionsDb.hasCommandPermission(message.guild.id, canonicalName, message.member);
      if (!allowed) {
        await message.reply(warningPayload(message, `You're missing the permission level required for \`${prefix}${canonicalName}\`.`)).catch(() => {});
        return;
      }
    } catch (err) {
      logger.error('Error checking custom command permission level:', err);
    }

    let interaction;
    try {
      interaction = await buildInteractionFromMessage(message, command, argText);
    } catch (err) {
      await message.reply(warningPayload(message, err.userFacing ? err.message : `Invalid usage. Try \`${commandUsage(command, prefix)}\` or \`${prefix}help ${canonicalName}\`.`)).catch(() => {});
      return;
    }

    if (!interaction) {
      await message.reply(warningPayload(message, `Unknown subcommand for \`${canonicalName}\`. Valid options: \`${commandUsage(command, prefix)}\`. Use \`${prefix}help ${canonicalName}\` for details.`)).catch(() => {});
      return;
    }

    interaction.pettoModerationRoleAllowed = moderationRoleOverride;
    interaction.pettoAutomodControl = hiddenAutomodControl;

    try {
      await command.execute(interaction, message.client);
    } catch (err) {
      logger.error(`Error executing ${prefix}${canonicalName}:`, err);
      const errorReply = warningPayload(message, err.userFacing ? err.message : 'Something went wrong while running that command.');
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorReply).catch(() => {});
      else await interaction.reply(errorReply).catch(() => {});
    }
  },
};
