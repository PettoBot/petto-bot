const { Events } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { buildInteractionFromMessage } = require('../handlers/prefixInteraction');
const { getRemainingCooldown } = require('../utils/cooldown');
const disabledDb = require('../db/disabledCommands');
const customCommandsDb = require('../db/customCommands');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('../utils/embedBuilder');
const { resolve } = require('../utils/embedVariables');
const logger = require('../utils/logger');

const DEFAULT_COOLDOWN_MS = 3000;
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
  if (!row) return;

  const ctx = { member: message.member, guild: message.guild, channel: message.channel, message };

  try {
    if (row.embed_template) {
      const doc = await getTemplate(message.guild.id, row.embed_template);
      if (doc) {
        const payload = await build(doc.data, ctx);
        await message.reply({ content: payload.content, embeds: payload.embeds, components: payload.components }).catch(() => {});
        return;
      }
    }
    if (row.response) {
      const resolved = await resolve(row.response, ctx);
      await message.reply(resolved).catch(() => {});
    }
  } catch (err) {
    logger.error(`Failed to run custom command "${commandName}" in guild ${message.guild.id}:`, err);
  }
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
    const commandName = (spaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, spaceIdx)).toLowerCase();
    const argText = spaceIdx === -1 ? '' : withoutPrefix.slice(spaceIdx + 1);

    const canonicalName = message.client.commandAliases.get(commandName) ?? commandName;
    const command = message.client.commands.get(canonicalName);
    if (!command || !command.data || (command.data.toJSON().type ?? 1) !== 1) {
      await runCustomCommand(message, canonicalName);
      return;
    }

    // Silent ignore, matching bli — a disabled command shouldn't even hint that it exists there.
    const disabled = await disabledDb.find(message.guild.id, canonicalName, message.channel.id).catch(() => null);
    if (disabled) return;

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
