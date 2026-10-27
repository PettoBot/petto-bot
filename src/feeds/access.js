// Who can use the feeds. They are open to every server; set FEEDS_PUBLIC=false in the environment and only the team (the owner, the developers)
// and the testers can follow accounts or change a feed (the feeds already made keep posting). The dashboard has the same switch.
const config = require('../config');

function canUseFeeds(userId) {
  if (config.feedsPublic) return true;
  return Boolean(userId) && (userId === config.ownerId || config.developerIds.includes(userId) || config.feedTesterIds.includes(userId));
}

module.exports = { canUseFeeds };
