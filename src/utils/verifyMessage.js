const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const config = require('../config');
const { MessageFlags } = require('discord.js');
const { templatePayload } = require('./templatedMessage');
const { getConfig } = require('../db/verificationConfig');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { methodOf } = require('./verifyMethod');
const { canDoLetters } = require('./verifyLink');
const { t, guildLanguage, currentLanguage } = require('../i18n');
const { sendDm } = require('./dmOrigin');
const ACCENT_COLOR = 0x4b4f59; // matches the verification page's accent
const SUCCESS_COLOR = 0xa5ea7a;


/** Public URL for a file in src/web/public, or null if the web server has no public base URL configured. */
function assetUrl(file) {
  return config.verifyBaseUrl ? `${config.verifyBaseUrl}/assets/${file}` : null;
}

/** Components V2 DM sent to a member who needs to verify — a small Petto thumbnail next to the welcome text + link. */
function buildVerifyDM({ guild, link, discordButton = false, lang = currentLanguage() }) {
  const lines = [t(lang, 'verify.dm.welcome', { server: guild.name }), t(lang, 'verify.dm.human')];
  if (link) lines.push(t(lang, 'verify.dm.link', { link }));
  if (discordButton) lines.push(t(lang, link ? 'verify.dm.orHere' : 'verify.dm.pressButton'));
  const text = new TextDisplayBuilder().setContent(lines.join('\n'));

  const container = new ContainerBuilder();
  const logo = assetUrl('favicon.png');

  if (logo) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(logo)));
  } else {
    container.addTextDisplayComponents(text);
  }

  // The link as a button too: a link inside the text is easy to miss on a phone.
  const row = new ActionRowBuilder();
  if (link) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link).setLabel(t(lang, 'verify.link.open')).setEmoji('🔗'));
  if (discordButton) row.addComponents(require('../interactions/verifyLetters').startButton(guild.id, lang));
  if (row.components.length) container.addActionRowComponents(row);
  return container;
}

/** Components V2 DM confirming a member passed verification. */
function buildVerifiedDM({ guild, lang = currentLanguage() }) {
  const text = new TextDisplayBuilder().setContent([t(lang, 'verify.dm.verifiedTitle'), t(lang, 'verify.dm.verifiedText', { server: guild.name })].join('\n'));

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
 * The DM is in the language of the server (`lang`, found when not given).
 */
async function sendVerifyDM(member, { guild, link, lang }) {
  const language = lang ?? await guildLanguage(guild.id);
  const settings = await getConfig(guild.id).catch(() => null);
  const discordButton = canDoLetters(methodOf(settings));
  const custom = await templatePayload(guild.id, settings?.prompt_embed_template, { guild, user: member.user ?? member, member, verify: { link: link ?? '' } });
  if (custom) {
    const payload = { ...custom, allowedMentions: { parse: [] } };
    // A saved design does not know about the button, so it goes in a row of its own below it.
    if (discordButton) payload.components = [...(payload.components ?? []), new ActionRowBuilder().addComponents(require('../interactions/verifyLetters').startButton(guild.id, language))];
    return sendDm(member, payload, { guild, kind: 'verify' });
  }
  return sendDm(member, { components: [buildVerifyDM({ guild, link, discordButton, lang: language })], flags: MessageFlags.IsComponentsV2 }, { guild, kind: 'verify' });
}

/** DMs the confirmation after a member verified, with the server's saved embed when one is chosen, in the language of the server. */
async function sendVerifiedDM(member, { guild, lang }) {
  const settings = await getConfig(guild.id).catch(() => null);
  const custom = await templatePayload(guild.id, settings?.verified_embed_template, { guild, user: member.user ?? member, member });
  if (custom) return sendDm(member, { ...custom, allowedMentions: { parse: [] } }, { guild, kind: 'verify' });
  return sendDm(member, { components: [buildVerifiedDM({ guild, lang: lang ?? await guildLanguage(guild.id) })], flags: MessageFlags.IsComponentsV2 }, { guild, kind: 'verify' });
}

module.exports = { buildVerifyDM, buildVerifiedDM, sendVerifyDM, sendVerifiedDM };
