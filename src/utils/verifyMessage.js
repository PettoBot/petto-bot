const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const config = require('../config');

const ACCENT_COLOR = 0x8399ff; // matches the verification page's accent
const SUCCESS_COLOR = 0xa5ea7a;

/** Public URL for a file in src/web/public, or null if the web server has no public base URL configured. */
function assetUrl(file) {
  return config.verifyBaseUrl ? `${config.verifyBaseUrl}/assets/${file}` : null;
}

/** Components V2 DM sent to a member who needs to verify — a small Petto thumbnail next to the welcome text + link. */
function buildVerifyDM({ guild, link }) {
  const text = new TextDisplayBuilder().setContent(
    [`### Welcome to ${guild.name}!`, "Verify you're human to get access to the rest of the server.", `**[Click here to verify](${link})**`].join('\n'),
  );

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
  const logo = assetUrl('favicon.png');

  if (logo) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(logo)));
  } else {
    container.addTextDisplayComponents(text);
  }

  return container;
}

/** Components V2 DM confirming a member passed verification. */
function buildVerifiedDM({ guild }) {
  const text = new TextDisplayBuilder().setContent(["### You're verified!", `You now have full access to **${guild.name}**. Welcome aboard!`].join('\n'));

  const container = new ContainerBuilder().setAccentColor(SUCCESS_COLOR);
  const logo = assetUrl('favicon.png');

  if (logo) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(logo)));
  } else {
    container.addTextDisplayComponents(text);
  }

  return container;
}

module.exports = { buildVerifyDM, buildVerifiedDM };
