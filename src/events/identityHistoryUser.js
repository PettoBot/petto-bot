const { Events } = require('discord.js');
const { noteUser } = require('../utils/identityHistory');

// A new name of a person (display name or username) is added to their history. A new avatar is not kept.
module.exports = {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    if (oldUser.globalName === newUser.globalName && oldUser.username === newUser.username) return;
    await noteUser(newUser);
  },
};
