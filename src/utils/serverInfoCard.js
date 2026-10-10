// The Components V2 card of `/serverinfo`. It takes plain numbers and text, so it can be checked without Discord.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { EMOJI } = require('./emojis');

const ACCENT = 0xf0a88f;
const BOOSTS_FOR_LEVEL = [0, 2, 7, 14];
// The features worth showing, with the words people know them by.
const FEATURE_NAMES = {
  COMMUNITY: 'Community', PARTNERED: 'Partnered', VERIFIED: 'Verified', DISCOVERABLE: 'Discoverable', VANITY_URL: 'Vanity link',
  ANIMATED_ICON: 'Animated icon', BANNER: 'Banner', ANIMATED_BANNER: 'Animated banner', INVITE_SPLASH: 'Invite splash',
  ROLE_ICONS: 'Role icons', NEWS: 'Announcements', WELCOME_SCREEN_ENABLED: 'Welcome screen', MEMBER_VERIFICATION_GATE_ENABLED: 'Rules screening',
};

const n = (value) => Number(value).toLocaleString('en-US');
const clip = (text, max) => { const value = String(text ?? ''); return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value; };
const unix = (ms) => Math.floor(Number(ms) / 1000);
const row = (icon, label, value) => `${icon} **${label}** ${value}`;
const joinParts = (parts) => parts.filter(Boolean).join('  ·  ');

/** "Level 2 · 9 boosts (5 more for level 3)". */
function boostText(tier, boosts) {
  const level = tier === 0 ? 'No level' : `Level ${tier}`;
  const count = `${n(boosts)} boost${boosts === 1 ? '' : 's'}`;
  if (tier >= 3) return `${level}  ·  ${count}`;
  const missing = BOOSTS_FOR_LEVEL[tier + 1] - boosts;
  return `${level}  ·  ${count}${missing > 0 ? ` (${n(missing)} more for level ${tier + 1})` : ''}`;
}

function featureList(features, max = 6) {
  const known = (features ?? []).filter((feature) => FEATURE_NAMES[feature]).map((feature) => FEATURE_NAMES[feature]);
  if (!known.length) return null;
  return known.length > max ? `${known.slice(0, max).join(', ')} and ${known.length - max} more` : known.join(', ');
}

/**
 * @param {object} d  Plain data: name, id, description, createdTimestamp, ownerId, iconUrl, bannerUrl, splashUrl, vanityUrl,
 *   memberCount, humans, bots, boosters (the last three can be null), boosts, tier, verification, locale, textChannels,
 *   forumChannels, voiceChannels, categories, roles, emojis, emojiLimit, stickers, stickerLimit, features, shard, shards.
 */
function buildServerInfoCard(d) {
  const header = [
    `## ${clip(d.name, 100)}`,
    d.description ? `> ${clip(d.description, 280)}` : null,
    row(EMOJI.FIELD_CALENDAR, 'Created', `<t:${unix(d.createdTimestamp)}:D> (<t:${unix(d.createdTimestamp)}:R>)`),
    row(EMOJI.FIELD_DOT, 'Owner', d.ownerId ? `<@${d.ownerId}>` : 'Unknown'),
  ].filter(Boolean).join('\n');

  const card = new ContainerBuilder().setAccentColor(ACCENT);
  const headerText = new TextDisplayBuilder().setContent(header);
  if (d.iconUrl) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText).setThumbnailAccessory(new ThumbnailBuilder().setURL(d.iconUrl)));
  else card.addTextDisplayComponents(headerText);
  if (d.bannerUrl) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(d.bannerUrl)));

  const members = [
    row(EMOJI.USER_UNMUTE, 'Members', joinParts([
      `${n(d.memberCount)}`,
      d.humans === null ? null : `${n(d.humans)} people`,
      d.bots === null ? null : `${n(d.bots)} bots`,
    ])),
    d.boosters === null ? null : row(EMOJI.STAR, 'Boosters', n(d.boosters)),
  ].filter(Boolean);

  const channelTotal = d.textChannels + d.forumChannels + d.voiceChannels + d.categories;
  const channels = row(EMOJI.FIELD_NOTES, `Channels (${n(channelTotal)})`, joinParts([
    `${n(d.textChannels)} text`, d.forumChannels ? `${n(d.forumChannels)} forums` : null, `${n(d.voiceChannels)} voice`, `${n(d.categories)} categories`,
  ]));

  const server = [
    row(EMOJI.STAR, 'Boost', boostText(d.tier, d.boosts)),
    row(EMOJI.FIELD_REASON, 'Safety', joinParts([`${d.verification} verification`, d.locale])),
    row(EMOJI.FIELD_DOT, 'Content', joinParts([`${n(d.roles)}/250 roles`, `${n(d.emojis)}/${n(d.emojiLimit)} emojis`, `${n(d.stickers)}/${n(d.stickerLimit)} stickers`])),
    featureList(d.features) ? row(EMOJI.APPROVE, 'Features', featureList(d.features)) : null,
  ].filter(Boolean);

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent([...members, channels].join('\n')));
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(server.join('\n')));
  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID ${d.id} · Shard ${d.shard}/${d.shards}`));

  const links = [['Icon', d.iconUrl], ['Banner', d.bannerUrl], ['Invite splash', d.splashUrl], ['Server link', d.vanityUrl]].filter(([, url]) => url);
  if (links.length) {
    card.addActionRowComponents(new ActionRowBuilder().addComponents(links.map(([label, url]) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url))));
  }
  return card;
}

function serverInfoPayload(data) {
  return { components: [buildServerInfoCard(data)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

module.exports = { buildServerInfoCard, serverInfoPayload, boostText, featureList };
