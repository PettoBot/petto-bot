// The language buttons of the setup message (English, Español, Português): they set the language of the server, only for people who can manage it,
// and the message says it is done in the new language. The same buttons are on the setup message of the private channel and on the direct
// messages (to the owner, and to whoever added Petto when the channel could not be made), so everything comes from the custom id.
const { MessageFlags, PermissionFlagsBits, AuditLogEvent } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { t, languageOf, setGuildLanguage } = require('../i18n');
const { PREFIX, parseCustomId } = require('../utils/languageChoice');
const { buildAdminSetupMessage, buildOwnerGuide, commandMention, commandSubcommandMention } = require('../utils/onboarding');
const { permissionName } = require('../utils/permissionLabels');
const { refreshGuildPanels } = require('../utils/panelRefresh');
const logger = require('../utils/logger');

const refuse = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** The setup message again, in the new language and with the notice that it is done. */
async function rebuildMessage({ kind, guild, language, prefix }) {
  const options = { guildId: guild.id, languageChoice: { language }, languageDone: true, prefix, lang: language };
  const setupMention = await commandMention(guild.client, 'setup', guild);
  if (kind === 'owner') return buildOwnerGuide({ guild, setupChannel: null, setupMention, ...options });
  const reportConfigMention = await commandSubcommandMention(guild.client, 'report', 'config', guild);
  return buildAdminSetupMessage({
    botId: guild.client.user.id, setupMention, reportConfigMention, fallback: kind === 'fallback', dm: kind === 'dm', guildName: guild.name, ...options,
  });
}

/** Whether a message of Petto carries the language buttons of this server, and which kind of message it is (the custom id says). */
function languageKindOf(message, guildId) {
  const text = JSON.stringify((message.components ?? []).map((component) => (typeof component.toJSON === 'function' ? component.toJSON() : component)));
  const match = new RegExp(`plang:([afdo]):${guildId}:`).exec(text);
  return match ? parseCustomId(`${PREFIX}${match[1]}:${guildId}:en`)?.kind ?? null : null;
}

/**
 * The same setup message lives in more than one place (the private channel, the direct message to the owner, the one to whoever added Petto),
 * each with its own language buttons. When the language changes in one of them the others are rebuilt in it too, so nobody has to press it again.
 * It looks at the last messages of the places it can reach (nothing is stored for this) and never makes anything: every failure is only logged.
 */
async function syncOtherCopies({ guild, language, prefix, clicked }) {
  const client = guild.client;
  const places = [];
  try {
    const { setup_channel_id: setupChannelId } = await ensureGuild(guild.id);
    if (setupChannelId) places.push(guild.channels?.fetch ? await guild.channels.fetch(setupChannelId).catch(() => null) : null);
  } catch { /* no channel to look at */ }
  const people = new Set([guild.ownerId].filter(Boolean));
  try {
    const logs = await guild.fetchAuditLogs?.({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs?.entries?.find((item) => item.target?.id === client.user.id);
    if (entry?.executor?.id) people.add(entry.executor.id);
  } catch { /* the inviter is not known: only the owner is looked at */ }
  for (const id of people) {
    const user = await client.users?.fetch?.(id).catch(() => null);
    places.push(user?.createDM ? await user.createDM().catch(() => null) : null);
  }
  let updated = 0;
  for (const place of places.filter(Boolean)) {
    const recent = await place.messages?.fetch?.({ limit: 15 }).catch(() => null);
    for (const message of recent?.values?.() ?? []) {
      if (message.author?.id !== client.user.id || message.id === clicked) continue;
      const kind = languageKindOf(message, guild.id);
      if (!kind) continue;
      const payload = await rebuildMessage({ kind, guild, language, prefix });
      if (await message.edit(payload).then(() => true).catch(() => false)) updated += 1;
    }
  }
  return updated;
}

async function canManage(interaction, guild) {
  const member = interaction.guildId ? interaction.member : await guild.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

async function handleButton(interaction) {
  const parsed = parseCustomId(interaction.customId);
  const viewer = await languageOf(interaction);
  if (!parsed) return refuse(interaction, t(viewer, 'setup.language.error', { prefix: '!' }));
  const guild = interaction.client.guilds.cache.get(parsed.guildId);
  // The buttons are tied to one server: pressed from another one (a copied message), or after Petto left, they do nothing.
  if (!guild || (interaction.guildId && interaction.guildId !== parsed.guildId)) return refuse(interaction, t(viewer, 'setup.language.gone'));

  if (!(await canManage(interaction, guild))) {
    return refuse(interaction, t(viewer, 'core.moderate.youNeed', { permission: permissionName('ManageGuild', viewer) }));
  }

  await interaction.deferUpdate();
  try {
    await setGuildLanguage(guild.id, parsed.language); // saved as chosen by a person: Petto never offers to change it again
    const { prefix } = await ensureGuild(guild.id);
    await interaction.editReply(await rebuildMessage({ kind: parsed.kind, guild, language: parsed.language, prefix: prefix || '!' }));
    syncOtherCopies({ guild, language: parsed.language, prefix: prefix || '!', clicked: interaction.message?.id }).catch((err) => logger.warn(`Could not update the other copies of the setup message of ${guild.id}: ${err.message}`));
    // The panels Petto already posted keep the words they had: they are redrawn, like `!language` does.
    refreshGuildPanels(guild, parsed.language).catch((err) => logger.warn(`Could not redraw the panels of ${guild.id} after a language button: ${err.message}`));
    logger.info(`language of ${guild.id} changed to ${parsed.language} with a button of the setup message`);
  } catch (err) {
    logger.error(`The language button failed in guild ${guild.id}:`, err);
    await interaction.followUp({ content: t(viewer, 'setup.language.error', { prefix: '!' }), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

module.exports = { PREFIX, handleButton, syncOtherCopies, languageKindOf };
