// The Components V2 card of `/serverinfo`. It takes plain numbers and text, so it can be checked without Discord.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { EMOJI } = require('./emojis');
const { t, tn, formatNumber, currentLanguage } = require('../i18n');

const ACCENT = 0xf0a88f;
const BOOSTS_FOR_LEVEL = [0, 2, 7, 14];
// The features worth showing, with the words people know them by (catalog keys).
const FEATURE_NAMES = {
  COMMUNITY: 'community', PARTNERED: 'partnered', VERIFIED: 'verified', DISCOVERABLE: 'discoverable', VANITY_URL: 'vanityUrl',
  ANIMATED_ICON: 'animatedIcon', BANNER: 'banner', ANIMATED_BANNER: 'animatedBanner', INVITE_SPLASH: 'inviteSplash',
  ROLE_ICONS: 'roleIcons', NEWS: 'news', WELCOME_SCREEN_ENABLED: 'welcomeScreen', MEMBER_VERIFICATION_GATE_ENABLED: 'rulesScreening',
};

const clip = (text, max) => { const value = String(text ?? ''); return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value; };
const unix = (ms) => Math.floor(Number(ms) / 1000);
const row = (icon, label, value) => `${icon} **${label}** ${value}`;
const joinParts = (parts) => parts.filter(Boolean).join('  ·  ');

/** "Level 2 · 9 boosts (5 more for level 3)". */
function boostText(tier, boosts, lang = currentLanguage()) {
  const level = tier === 0 ? t(lang, 'info.serverinfo.noLevel') : t(lang, 'info.serverinfo.level', { level: tier });
  const count = tn(lang, 'info.serverinfo.boosts', boosts);
  if (tier >= 3) return `${level}  ·  ${count}`;
  const missing = BOOSTS_FOR_LEVEL[tier + 1] - boosts;
  return `${level}  ·  ${count}${missing > 0 ? ` ${tn(lang, 'info.serverinfo.boostsMissing', missing, { level: tier + 1 })}` : ''}`;
}

function featureList(features, max = 6, lang = currentLanguage()) {
  const known = (features ?? []).filter((feature) => FEATURE_NAMES[feature]).map((feature) => t(lang, `info.serverinfo.feature.${FEATURE_NAMES[feature]}`));
  if (!known.length) return null;
  return known.length > max ? t(lang, 'info.serverinfo.featuresMore', { list: known.slice(0, max).join(', '), count: known.length - max }) : known.join(', ');
}

/**
 * @param {object} d  Plain data: name, id, description, createdTimestamp, ownerId, iconUrl, bannerUrl, splashUrl, vanityUrl,
 *   memberCount, humans, bots, boosters (the last three can be null), boosts, tier, verification, locale, textChannels,
 *   forumChannels, voiceChannels, categories, roles, emojis, emojiLimit, stickers, stickerLimit, features, shard, shards.
 */
function buildServerInfoCard(d) {
  const lang = d.lang ?? currentLanguage();
  const n = (value) => formatNumber(lang, value);
  const header = [
    `## ${clip(d.name, 100)}`,
    d.description ? `> ${clip(d.description, 280)}` : null,
    row(EMOJI.FIELD_CALENDAR, t(lang, 'info.label.created'), `<t:${unix(d.createdTimestamp)}:D> (<t:${unix(d.createdTimestamp)}:R>)`),
    row(EMOJI.FIELD_DOT, t(lang, 'info.serverinfo.owner'), d.ownerId ? `<@${d.ownerId}>` : t(lang, 'info.unknown')),
  ].filter(Boolean).join('\n');

  const card = new ContainerBuilder().setAccentColor(ACCENT);
  const headerText = new TextDisplayBuilder().setContent(header);
  if (d.iconUrl) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText).setThumbnailAccessory(new ThumbnailBuilder().setURL(d.iconUrl)));
  else card.addTextDisplayComponents(headerText);
  if (d.bannerUrl) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(d.bannerUrl)));

  const members = [
    row(EMOJI.MEMBERS, t(lang, 'info.label.members'), joinParts([
      `${n(d.memberCount)}`,
      d.humans === null ? null : tn(lang, 'info.serverinfo.people', d.humans),
      d.bots === null ? null : tn(lang, 'info.serverinfo.bots', d.bots),
    ])),
    d.boosters === null ? null : row(EMOJI.STAR, t(lang, 'info.serverinfo.boosters'), n(d.boosters)),
  ].filter(Boolean);

  const channelTotal = d.textChannels + d.forumChannels + d.voiceChannels + d.categories;
  const channels = row(EMOJI.FIELD_NOTES, t(lang, 'info.serverinfo.channels', { count: n(channelTotal) }), joinParts([
    tn(lang, 'info.serverinfo.text', d.textChannels),
    d.forumChannels ? tn(lang, 'info.serverinfo.forums', d.forumChannels) : null,
    tn(lang, 'info.serverinfo.voice', d.voiceChannels),
    tn(lang, 'info.serverinfo.categories', d.categories),
  ]));

  const features = featureList(d.features, 6, lang);
  const server = [
    row(EMOJI.STAR, t(lang, 'info.serverinfo.boost'), boostText(d.tier, d.boosts, lang)),
    row(EMOJI.SAFETY, t(lang, 'info.serverinfo.safety'), joinParts([t(lang, 'info.serverinfo.verificationLevel', { level: d.verification }), d.locale])),
    row(EMOJI.FIELD_DOT, t(lang, 'info.serverinfo.content'), joinParts([
      t(lang, 'info.serverinfo.roles', { count: n(d.roles) }),
      t(lang, 'info.serverinfo.emojis', { count: n(d.emojis), max: n(d.emojiLimit) }),
      t(lang, 'info.serverinfo.stickers', { count: n(d.stickers), max: n(d.stickerLimit) }),
    ])),
    features ? row(EMOJI.APPROVE, t(lang, 'info.serverinfo.features'), features) : null,
  ].filter(Boolean);

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent([...members, channels].join('\n')));
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(server.join('\n')));
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'info.serverinfo.footer', { id: d.id, shard: d.shard, shards: d.shards })));

  const links = [
    [t(lang, 'info.serverinfo.icon.button'), d.iconUrl],
    [t(lang, 'info.button.banner.button'), d.bannerUrl],
    [t(lang, 'info.serverinfo.splash.button'), d.splashUrl],
    [t(lang, 'info.serverinfo.vanity.button'), d.vanityUrl],
  ].filter(([, url]) => url);
  if (links.length) {
    card.addActionRowComponents(new ActionRowBuilder().addComponents(links.map(([label, url]) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url))));
  }
  return card;
}

function serverInfoPayload(data) {
  return { components: [buildServerInfoCard(data)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

module.exports = { buildServerInfoCard, serverInfoPayload, boostText, featureList };
