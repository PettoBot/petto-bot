// Who can use the feeds. While they are being tested only the team (the owner, the developers) and the testers can follow accounts or change a
// feed; the feeds already made keep posting. Set FEEDS_PUBLIC=true in the environment to open them to every server (the dashboard has the same switch).
const config = require('../config');

function canUseFeeds(userId) {
  if (config.feedsPublic) return true;
  return Boolean(userId) && (userId === config.ownerId || config.developerIds.includes(userId) || config.feedTesterIds.includes(userId));
}

module.exports = { canUseFeeds };
