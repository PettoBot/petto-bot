const { MessageFlags } = require('discord.js');
const { getEvent, markRestored, getConfig } = require('../db/antinuke');
const { restoreEvent, canRestore } = require('../utils/antiNukeRestore');
const { RESTORE_PREFIX } = require('../utils/antiNuke');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

/** The restore button of an anti-nuke alert, `an_restore::<event id>`. Only the owner, the trusted admins and (unless "owner only" is on) the administrators can press it. */
async function handleButton(interaction) {
  const id = Number(interaction.customId.split('::')[1]);
  if (!interaction.guild || !Number.isInteger(id)) return;
  const lang = await languageOf(interaction);
  if (!canRestore(interaction.member, await getConfig(interaction.guild.id).catch(() => null))) {
    await interaction.reply({ content: t(lang, 'security.antinuke.button.notAllowed'), flags: MessageFlags.Ephemeral });
    return;
  }
  const event = await getEvent(interaction.guild.id, id).catch(() => null);
  if (!event) {
    await interaction.reply({ content: t(lang, 'security.antinuke.button.gone'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (event.restored_at) {
    await interaction.reply({ content: t(lang, 'security.antinuke.restore.already'), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { done, failed } = await restoreEvent(interaction.guild, event, lang);
    if (!failed.length) await markRestored(interaction.guild.id, id).catch(() => {});
    const lines = [...done.map((l) => `• ${l}`), ...failed.map((l) => `• ${l}`)];
    await interaction.editReply({ content: lines.length ? lines.join('\n').slice(0, 1900) : t(lang, 'security.antinuke.restore.nothing'), allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Anti-nuke restore failed:', err);
    await interaction.editReply({ content: t(lang, 'security.antinuke.restore.failed') });
  }
}

module.exports = { PREFIX: RESTORE_PREFIX, handleButton };
