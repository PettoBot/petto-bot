// The language buttons of the setup message (English, Español, Português): they set the language of the server, only for people who can manage it,
// and the message says it is done in the new language. The same buttons are on the setup message of the private channel and on the direct
// messages (to the owner, and to whoever added Petto when the channel could not be made), so everything comes from the custom id.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
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
    // The panels Petto already posted keep the words they had: they are redrawn, like `!language` does.
    refreshGuildPanels(guild, parsed.language).catch((err) => logger.warn(`Could not redraw the panels of ${guild.id} after a language button: ${err.message}`));
    logger.info(`language of ${guild.id} changed to ${parsed.language} with a button of the setup message`);
  } catch (err) {
    logger.error(`The language button failed in guild ${guild.id}:`, err);
    await interaction.followUp({ content: t(viewer, 'setup.language.error', { prefix: '!' }), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

module.exports = { PREFIX, handleButton };
