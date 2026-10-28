// The buttons of the music card and the menu of a search (previous, pause, stop, skip, loop, queue, volume, shuffle, leave). Each one asks the session of the server for the same
// thing the command does; only people in the voice channel where the bot plays can press them.
const service = require('../music/service');

const PREFIX = 'music';

async function handleButton(interaction) {
  const [, action, token] = interaction.customId.split(':');
  if (action === 'pick' && interaction.isStringSelectMenu?.()) { await service.pick(interaction, token); return; } // the menu of a search
  if (!interaction.isButton()) return;
  await service.button(interaction, action);
}

module.exports = { PREFIX, handleButton };
