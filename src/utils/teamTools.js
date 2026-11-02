// i18n-ignore-file: helpers of the private tools of the Petto team; they read English.
// What the team commands (`!leaveguild`, `!guildsend`, `!guilddebug`, `!blacklist`, `!botstatus`, `!slots`, `!team`) share, so they all behave alike:
//   - the gate: only the owner and PETTO_DEVELOPER_IDS (`isPettoOperator`), and nobody else gets an answer;
//   - how a server is named: an ID, a name that only one of the servers of Petto has, or the server where the command is typed;
//   - how a server is shown (name, ID, members, owner), how a team action is written in the operations channel, and the confirmation buttons.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config');
const { isPettoOperator } = require('./autoModControl');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const SNOWFLAKE_RE = /^\d{15,25}$/;
const NO_MENTIONS = { parse: [] };

/** One line of text: no line breaks, no backticks, no way to ping, clipped. */
const oneLine = (value, max = 100) => {
  const text = String(value ?? '').replace(/[`\r\n\t]+/g, ' ').replace(/@/g, '@​').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The gate of every team command: false for everybody who is not the owner or a developer. Nothing is sent to them. */
const isTeam = (userId) => isPettoOperator(String(userId ?? ''));

/**
 * The server a team command talks about. `query`: an ID, a name (exact, any case) that only ONE server of Petto has, or empty / `here` for the server
 * where the command was typed. Returns `{ ok: true, guild, id, via }` (`guild` is null when only the ID is known), or `{ ok: false, reason: 'none' | 'ambiguous' |
 * 'unknown', matches }`. Nothing is fetched from Discord when the cache has the answer.
 */
async function findGuild(client, query, { current = null, fetch = true } = {}) {
  const text = String(query ?? '').trim();
  if (!text || /^(here|this)$/i.test(text)) return current ? { ok: true, guild: current, id: current.id, via: 'here' } : { ok: false, reason: 'none', matches: [] };
  if (SNOWFLAKE_RE.test(text)) {
    const guild = client.guilds.cache.get(text) ?? (fetch ? await client.guilds.fetch(text).catch(() => null) : null);
    return { ok: true, guild: guild ?? null, id: text, via: 'id' };
  }
  const wanted = text.toLowerCase();
  const matches = [...client.guilds.cache.values()].filter((guild) => String(guild.name ?? '').toLowerCase() === wanted);
  if (matches.length === 1) return { ok: true, guild: matches[0], id: matches[0].id, via: 'name' };
  return { ok: false, reason: matches.length ? 'ambiguous' : 'unknown', matches };
}

/** Why a server could not be found, in a sentence for the team. */
function notFoundText(found, query) {
  if (found.reason === 'ambiguous') return `${found.matches.length} servers of Petto are called **${oneLine(query)}**: use the ID (${found.matches.slice(0, 5).map((guild) => `\`${guild.id}\``).join(', ')}).`;
  if (found.reason === 'none') return 'Give a server ID or the name of one of Petto\'s servers.';
  return `Petto is in no server called **${oneLine(query)}**. Use its ID, or the exact name.`;
}

/** The facts of a server the team needs to see before and after an action: name, ID, members and owner. */
function guildLine(guild, id = guild?.id) {
  if (!guild) return `\`${id}\` (Petto is not in it)`;
  const members = Number.isFinite(guild.memberCount) ? guild.memberCount.toLocaleString('en-US') : 'unknown';
  return `**${oneLine(guild.name, 80) || 'Unknown server'}** (\`${guild.id}\`) · ${members} members · owner ${guild.ownerId ? `\`${guild.ownerId}\`` : 'unknown'}`;
}

/** The servers that must never be left or blacklisted by a team command: the operations server and the support server. */
async function protectedGuildIds(client) {
  const { resolveOpsGuildId } = require('./opsGuild');
  const ids = new Set([config.supportGuildId, config.opsGuildId].filter(Boolean).map(String));
  const ops = await resolveOpsGuildId(client).catch(() => null);
  if (ops) ids.add(String(ops));
  return ids;
}

/** A note in the operations channel (English, no mention can ping). Returns the message, or null when there is no channel or it could not be sent. */
async function opsNote(client, text, { channelId = config.opsChannels?.general } = {}) {
  if (!channelId) return null;
  try {
    const channel = client.channels.cache?.get?.(channelId) ?? await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.() || !channel.send) return null;
    return await channel.send({ content: String(text).slice(0, 1900), allowedMentions: NO_MENTIONS });
  } catch (error) {
    logger.warn({ action: 'team-ops' }, `A team note could not be posted in ${channelId}: ${error.message}`);
    return null;
  }
}

/**
 * Asks the person who typed the command for a yes or a no with two buttons that only they can press, and gives up after 30 seconds.
 * `ask` is the text of the question; it edits the reply of the command. Returns `{ confirmed: boolean, click }`: `click` is the interaction of the button
 * (answer it with `click.update(...)`), or null when the time ran out (the reply was already changed to say so).
 */
async function confirm(interaction, ask, { yes = 'Yes, do it', no = 'No', time = 30_000, color = 0xfed53c } = {}) {
  const id = `${interaction.id ?? 'team'}-${Date.now().toString(36)}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`teamyes:${id}`).setLabel(yes).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`teamno:${id}`).setLabel(no).setStyle(ButtonStyle.Secondary),
  );
  const payload = { components: [textCard(`${EMOJI.WARNING} ${ask}\n-# Only you can answer, and only for 30 seconds.`, color), row], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
  const prompt = interaction.deferred || interaction.replied ? await interaction.editReply(payload) : await interaction.reply(payload);
  const message = prompt ?? await interaction.fetchReply?.();
  let click;
  try {
    click = await message.awaitMessageComponent({ filter: (pressed) => pressed.user.id === interaction.user.id && pressed.customId.endsWith(`:${id}`), time });
  } catch {
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY} Nobody answered in 30 seconds: nothing was done.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS }).catch(() => {});
    return { confirmed: false, click: null };
  }
  return { confirmed: click.customId.startsWith('teamyes:'), click };
}

/** The usual team reply: one card, V2, no mention can ping. `edit`: the command already answered (or deferred). */
function teamReply(interaction, text, color) {
  const payload = { components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
  return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
}

module.exports = { SNOWFLAKE_RE, oneLine, isTeam, findGuild, notFoundText, guildLine, protectedGuildIds, opsNote, confirm, teamReply };
