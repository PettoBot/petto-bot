// Makes the bot connect to the gateway as the phone app, so the member list shows the phone icon next to its status dot.
// Discord decides that from the `browser` and `device` it names when it identifies; the library does not let a bot choose them (it sends its own
// name), so the defaults the gateway library reads are changed before the client is created.
const MOBILE_CLIENT = 'Discord iOS';

function applyMobileIdentify() {
  const gateway = require(require.resolve('@discordjs/ws', { paths: [require.resolve('discord.js')] }));
  const properties = gateway.DefaultWebSocketManagerOptions.identifyProperties;
  properties.browser = MOBILE_CLIENT;
  properties.device = MOBILE_CLIENT;
  return properties;
}

module.exports = { MOBILE_CLIENT, applyMobileIdentify };
