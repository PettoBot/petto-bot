const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const config = require('../config');
const { MessageFlags } = require('discord.js');
const { templatePayload } = require('./templatedMessage');
const { getConfig } = require('../db/verificationConfig');
const { ActionRowBuilder } = require('discord.js');
const { methodOf, inDiscord } = require('./verifyMethod');
const ACCENT_COLOR = 0x4b4f59; // matches the verification page's accent
const SUCCESS_COLOR = 0xa5ea7a;


/** Public URL for a file in src/web/public, or null if the web server has no public base URL configured. */
function assetUrl(file) {
  return config.verifyBaseUrl ? `${config.verifyBaseUrl}/assets/${file}` : null;
}

/** Components V2 DM sent to a member who needs to verify — a small Petto thumbnail next to the welcome text + link. */
function buildVerifyDM({ guild, link, discordButton = false }) {
  const lines = [`### Welcome to ${guild.name}!`, "Verify you're human to get access to the rest of the server."];
  if (link) lines.push(`**[Click here to verify](${link})**`);
  if (discordButton) lines.push(link ? 'Or do it right here, without leaving Discord:' : 'Press the button and type the letters of a picture.');
  const text = new TextDisplayBuilder().setContent(lines.join('\n'));

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);
  const logo = assetUrl('favicon.png');

  if (logo) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(logo)));
  } else {
    container.addTextDisplayComponents(text);
  }

  if (discordButton) container.addActionRowComponents(new ActionRowBuilder().addComponents(require('../interactions/verifyLetters').startButton(guild.id)));
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

/**
 * DMs the verification link (and, when the server uses the letters check, a button to do it in Discord), with the server's saved embed
 * when one is chosen. `link` is empty for a server that verifies only inside Discord. Rejects if the DM cannot be sent.
 */
async function sendVerifyDM(member, { guild, link }) {
  const settings = await getConfig(guild.id).catch(() => null);
  const discordButton = inDiscord(methodOf(settings));
  const custom = await templatePayload(guild.id, settings?.prompt_embed_template, { guild, user: member.user ?? member, member, verify: { link: link ?? '' } });
  if (custom) {
    const payload = { ...custom, allowedMentions: { parse: [] } };
    // A saved design does not know about the button, so it goes in a row of its own below it.
    if (discordButton) payload.components = [...(payload.components ?? []), new ActionRowBuilder().addComponents(require('../interactions/verifyLetters').startButton(guild.id))];
    return member.send(payload);
  }
  return member.send({ components: [buildVerifyDM({ guild, link, discordButton })], flags: MessageFlags.IsComponentsV2 });
}

/** DMs the confirmation after a member verified, with the server's saved embed when one is chosen. */
async function sendVerifiedDM(member, { guild }) {
  const settings = await getConfig(guild.id).catch(() => null);
  const custom = await templatePayload(guild.id, settings?.verified_embed_template, { guild, user: member.user ?? member, member });
  if (custom) return member.send({ ...custom, allowedMentions: { parse: [] } });
  return member.send({ components: [buildVerifiedDM({ guild })], flags: MessageFlags.IsComponentsV2 });
}

module.exports = { buildVerifyDM, buildVerifiedDM, sendVerifyDM, sendVerifiedDM };
