// Buttons and menus made by custom commands written in code. Their id is cc:<command>:<handler>:<data>:<lock>, and using one
// runs that command again, see runComponent in utils/codeCommands.js.
const { MessageFlags } = require('discord.js');
const ccDb = require('../db/customCommands');
const { COMPONENT_PREFIX, parseComponentId, runComponent } = require('../utils/codeCommands');

async function handleComponent(interaction) {
  const parsed = parseComponentId(interaction.customId);
  if (!parsed || !interaction.guild) return;
  const row = await ccDb.getCommand(interaction.guild.id, parsed.command).catch(() => null);
  if (!row?.code) {
    await interaction.reply({ content: 'That command does not exist anymore.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  await runComponent(interaction, row, parsed);
}

module.exports = { COMPONENT_PREFIX, handleComponent };
