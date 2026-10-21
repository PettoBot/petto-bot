const { Events } = require('discord.js');
const ticketLive = require('../utils/ticketLive');

// A channel made or deleted in a server whose live tickets are open on the dashboard: a ticket may have opened or lost its channel, so
// the view reads its list again (see utils/ticketLive.js). Nothing happens for the other servers.
module.exports = {
  name: Events.ChannelDelete,
  execute(channel) {
    ticketLive.noteChannel(channel);
  },
};
