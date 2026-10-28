// The buttons of the music card (previous, pause, stop, skip, loop, queue, volume, shuffle, leave). Each one asks the session of the server for the same
// thing the command does; only people in the voice channel where the bot plays can press them.
const service = require('../music/service');

const PREFIX = 'music';

async function handleButton(interaction) {
  const [, action] = interaction.customId.split(':');
  await service.button(interaction, action);
}

module.exports = { PREFIX, handleButton };
