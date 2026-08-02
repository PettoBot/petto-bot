const { Events, MessageFlags } = require('discord.js');
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
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

const DEFAULT_COOLDOWN_MS = 3000;
const UNKNOWN_COMMAND_DELETE_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const prefixCache = new Map(); // guildId -> { prefix, expiresAt }

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

/** Falls back here whenever `commandName` doesn't match a real command — tries a guild's admin-defined custom commands before giving up silently. */
async function runCustomCommand(message, commandName) {
  const row = await customCommandsDb.getCommand(message.guild.id, commandName).catch(() => null);
  if (!row) return false;
  message.channel.sendTyping().catch(() => {});

  const ctx = { member: message.member, guild: message.guild, channel: message.channel, message };

  try {
    if (row.embed_template) {
      const doc = await getTemplate(message.guild.id, row.embed_template);
      if (doc) {
        const payload = await build(doc.data, ctx);
        await message.reply({ content: payload.content, embeds: payload.embeds, components: payload.components }).catch(() => {});
        return true;
      }
    }
    if (row.response) {
      const resolved = await resolve(row.response, ctx);
      await message.reply(resolved).catch(() => {});
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
    if (!message.client.commands.has(commandName) && !message.client.commandAliases.has(commandName)) {
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

    const canonicalName = message.client.commandAliases.get(commandName) ?? commandName;
    const command = message.client.commands.get(canonicalName);
    if (!command || !command.data || (command.data.toJSON().type ?? 1) !== 1) {
      const handled = await runCustomCommand(message, canonicalName);
      if (!handled) {
        const warning = await message
          .reply({ components: [textCard(`${EMOJI.WARNING}  Unknown command \`${canonicalName}\`. Use \`${prefix}help\` to see all commands.`, 0xfed53c)], flags: MessageFlags.IsComponentsV2 })
          .catch(() => null);
        // Matches bli: the "unknown command" nudge clears itself out instead of cluttering chat.
        if (warning) setTimeout(() => warning.delete().catch(() => {}), UNKNOWN_COMMAND_DELETE_MS);
      }
      return;
    }

    // Silent ignore, matching bli — a disabled command shouldn't even hint that it exists there.
    const disabled = await disabledDb.findCached(message.guild.id, canonicalName, message.channel.id).catch(() => null);
    if (disabled) return;

    // Real command, actually going to run now — the "Bot is typing..." indicator is the only
    // feedback a message-based command can give before its reply lands, so fire it as early as
    // possible instead of leaving the channel silent through cooldown/permission/arg-parsing
    // checks and the command's own DB/Discord API calls.
    message.channel.sendTyping().catch(() => {});

    const cooldownMs = command.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const remaining = getRemainingCooldown(canonicalName, message.author.id, cooldownMs);
    if (remaining > 0) {
      await message.reply(`Please wait ${(remaining / 1000).toFixed(1)}s before using \`${prefix}${canonicalName}\` again.`).catch(() => {});
      return;
    }

    if (!checkDefaultPermission(command.data.toJSON(), message.member)) {
      await message.reply("You don't have permission to use that command.").catch(() => {});
      return;
    }

    try {
      const allowed = await permissionsDb.hasCommandPermission(message.guild.id, canonicalName, message.member);
      if (!allowed) {
        await message.reply("You don't have the required permission level to use this command.").catch(() => {});
        return;
      }
    } catch (err) {
      logger.error('Error checking custom command permission level:', err);
    }

    let interaction;
    try {
      interaction = await buildInteractionFromMessage(message, command, argText);
    } catch (err) {
      await message.reply(err.userFacing ? err.message : 'Invalid command usage.').catch(() => {});
      return;
    }

    if (!interaction) {
      await message.reply(`Unknown subcommand. Usage: \`${prefix}${canonicalName} <subcommand> ...\``).catch(() => {});
      return;
    }

    try {
      await command.execute(interaction, message.client);
    } catch (err) {
      logger.error(`Error executing ${prefix}${canonicalName}:`, err);
      const errorReply = { content: err.userFacing ? err.message : 'Something went wrong while running that command.' };
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorReply).catch(() => {});
      else await interaction.reply(errorReply).catch(() => {});
    }
  },
};
