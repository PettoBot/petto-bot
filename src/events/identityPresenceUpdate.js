const { Events } = require('discord.js');
const { evaluateMember, customStatusOf } = require('../utils/identity/service');

// A change of Custom Status is what Vanity rules with the source custom_status look at.
module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    const member = newPresence?.member;
    if (!member || member.user?.bot) return;
    if (oldPresence && customStatusOf(oldPresence) === customStatusOf(newPresence)) return;
    await evaluateMember(member, { source: 'vanity' });
  },
};
