const { Events } = require('discord.js');
const { noteUser } = require('../utils/identityHistory');

// A new avatar or name of a person is added to their history.
module.exports = {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    if (oldUser.avatar === newUser.avatar && oldUser.globalName === newUser.globalName && oldUser.username === newUser.username) return;
    await noteUser(newUser);
  },
};
