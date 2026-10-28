// Who can use the music commands. While it is tested only the owner, the developers and the testers can; MUSIC_PUBLIC=true opens it to every server.
const config = require('../config');

function canUseMusic(userId) {
  if (config.musicPublic) return true;
  return Boolean(userId) && (userId === config.ownerId || config.developerIds.includes(userId) || config.musicTesterIds.includes(userId));
}

module.exports = { canUseMusic };
