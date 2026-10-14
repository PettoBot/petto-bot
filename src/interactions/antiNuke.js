const { MessageFlags } = require('discord.js');
const { getEvent, markRestored } = require('../db/antinuke');
const { restoreEvent, canRestore } = require('../utils/antiNukeRestore');
const { RESTORE_PREFIX } = require('../utils/antiNuke');
const logger = require('../utils/logger');

/** The restore button of an anti-nuke alert, `an_restore::<event id>`. Only the owner and the administrators can press it. */
async function handleButton(interaction) {
  const id = Number(interaction.customId.split('::')[1]);
  if (!interaction.guild || !Number.isInteger(id)) return;
  if (!canRestore(interaction.member)) {
    await interaction.reply({ content: 'Only the server owner and administrators can restore what the anti-nuke stopped.', flags: MessageFlags.Ephemeral });
    return;
  }
  const event = await getEvent(interaction.guild.id, id).catch(() => null);
  if (!event) {
    await interaction.reply({ content: 'That event no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (event.restored_at) {
    await interaction.reply({ content: 'This was already restored.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { done, failed } = await restoreEvent(interaction.guild, event);
    if (!failed.length) await markRestored(interaction.guild.id, id).catch(() => {});
    const lines = [...done.map((l) => `• ${l}`), ...failed.map((l) => `• ${l}`)];
    await interaction.editReply({ content: lines.length ? lines.join('\n').slice(0, 1900) : 'There was nothing left to restore.', allowedMentions: { parse: [] } });
  } catch (err) {
    logger.error('Anti-nuke restore failed:', err);
    await interaction.editReply({ content: 'Something went wrong restoring this.' });
  }
}

module.exports = { PREFIX: RESTORE_PREFIX, handleButton };
