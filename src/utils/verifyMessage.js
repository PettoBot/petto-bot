const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const config = require('../config');
const { MessageFlags } = require('discord.js');
const { templatePayload } = require('./templatedMessage');
const { getConfig } = require('../db/verificationConfig');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { methodOf } = require('./verifyMethod');
const { canDoLetters } = require('./verifyLink');
const { t, guildLanguage, currentLanguage } = require('../i18n');
const { sendDm } = require('./dmOrigin');
const { startButton, serverPicture, withPicture } = require('./verifyCards');
const ACCENT_COLOR = 0x4b4f59; // matches the verification page's accent
const SUCCESS_COLOR = 0xa5ea7a;


/** Public URL for a file in src/web/public, or null if the web server has no public base URL configured. */
function assetUrl(file) {
  return config.verifyBaseUrl ? `${config.verifyBaseUrl}/assets/${file}` : null;
}

/**
 * The DM a member gets when they join a server that verifies (Components V2): the server's name and icon, and a row for each way the server
 * allows with its button on its side (the link, and the letters inside Discord), like the panel of the channel. `link` is empty for a server
 * that verifies only inside Discord.
 */
function buildVerifyDM({ guild, link, discordButton = false, lang = currentLanguage() }) {
  const way = (key, button) => new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, `verify.panel.way.${key}`))).setButtonAccessory(button);
  const container = withPicture(new ContainerBuilder(), [t(lang, 'verify.dm.welcome', { server: guild.name }), t(lang, 'verify.dm.intro')].join('\n'), serverPicture(guild))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  // The link as a button too: a link inside the text is easy to miss on a phone.
  if (link) container.addSectionComponents(way('link', new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link).setLabel(t(lang, 'verify.link.open')).setEmoji('🔗')));
  if (discordButton) container.addSectionComponents(way('letters', startButton(guild.id, lang)));
  return container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'verify.dm.footer')));
}

/** Components V2 DM confirming a member passed verification: the server's name and icon, and a button that opens the server. */
function buildVerifiedDM({ guild, lang = currentLanguage() }) {
  const text = [t(lang, 'verify.dm.verifiedTitle'), t(lang, 'verify.dm.verifiedText', { server: guild.name })].join('\n');
  return withPicture(new ContainerBuilder().setAccentColor(SUCCESS_COLOR), text, serverPicture(guild))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}`).setLabel(t(lang, 'verify.dm.goToServer')).setEmoji('➡️')));
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
    if (discordButton) payload.components = [...(payload.components ?? []), new ActionRowBuilder().addComponents(startButton(guild.id, language))];
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
