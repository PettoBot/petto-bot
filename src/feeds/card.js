// The message a feed sends: an optional line of text on top (a ping and the words the server chose), and a Components V2 card:
//   [ emoji **[Title](link)**            [picture] ]
//   [ -# the description, when there is one       ]
//   ──────────
//   [ the cover picture, when there is one        ]
//   -# the kind of notice · the account · when
// The side bar has the color of the platform. Nothing here reads the network: the services give `item`, and the same builder makes the
// answer of the real feeds, the test of the dashboard and the screenshots of the site.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { PLATFORMS, fallbackPicture } = require('./platforms');
const emojis = require('./emojis');
const { plainText, linkText, safeUrl, clip, MAX_DESCRIPTION, MAX_TOP } = require('./text');
const { t } = require('../i18n');
const { heroFor } = require('./hero');

/**
 * What a feed knows about one notice. `item`:
 *   platform, type, title, url, description?, image?, avatar?, author?, authorUrl?, publishedAt? (ms or ISO), extra? (a line of its own: the game, the viewers…)
 */

const ENDED_COLOR = 0x4f545c; // a stream that is over goes grey

const VARIABLES = {
  'feed.title': (item) => plainText(item.title, 200),
  'feed.url': (item) => safeUrl(item.url) ?? '',
  'feed.author': (item) => plainText(item.author, 100),
  'feed.description': (item) => plainText(item.description, MAX_DESCRIPTION),
  'feed.platform': (item) => PLATFORMS[item.platform]?.name ?? '',
  'feed.image': (item) => safeUrl(item.image) ?? '',
};

/** The words a server wrote for a feed, with `{feed.title}`, `{feed.url}`, `{feed.author}`, `{feed.description}`, `{feed.platform}` and `{feed.image}` filled in. */
function renderMessage(text, item) {
  return String(text ?? '').replace(/\{(feed\.[a-z]+)\}/g, (match, name) => (VARIABLES[name] ? VARIABLES[name](item) : match));
}

const toMs = (value) => {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/** The pings of a feed: the roles it names, and `@everyone` when it was asked for. */
function pingLine(feed) {
  const parts = [];
  if (feed.ping_everyone) parts.push('@everyone');
  for (const id of feed.ping_roles ?? []) if (/^\d{15,25}$/.test(String(id))) parts.push(`<@&${id}>`);
  return parts.join(' ');
}

function allowedMentionsOf(feed) {
  return { parse: feed.ping_everyone ? ['everyone'] : [], roles: (feed.ping_roles ?? []).filter((id) => /^\d{15,25}$/.test(String(id))), users: [], repliedUser: false };
}

/**
 * The message of a feed for an item.
 * `feed`: { message, ping_roles, ping_everyone, options: { image, button, player, color } }. `test` puts a small "test" mark on the top line.
 */
function buildFeedMessage(feed, item, { lang, test = false, hero = null } = {}) {
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.rss;
  const options = feed.options ?? {};
  const components = [];

  const top = [pingLine(feed), clip(renderMessage(feed.message, item).trim(), MAX_TOP), test ? `-# ${emojis.TYPE.ended} ${t(lang, 'feeds.test.badge')}` : '']
    .filter(Boolean).join(' ').trim();
  if (top) components.push(new TextDisplayBuilder().setContent(top));

  const url = safeUrl(item.url);

  // The player of the video, like a person pasting the link: a plain message (Discord draws the playable video itself), not a card. Only for the videos and Shorts of YouTube.
  if (options.player && item.platform === 'youtube' && (item.type === 'video' || item.type === 'short') && url) {
    return { content: [top, url].filter(Boolean).join('\n'), allowedMentions: allowedMentionsOf(feed) };
  }

  // A release with its own picture (the cover and the title drawn together): the picture, the kind of notice with the time, and a button.
  if (hero) {
    const card = new ContainerBuilder().setAccentColor(Number.isInteger(options.color) ? options.color : platform.color);
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${hero.name}`)));
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const when = toMs(item.publishedAt);
    const meta = [`${emojis.PLATFORM[item.platform] ?? ''} ${t(lang, `feeds.type.${item.type}`)}`.trim(), when ? `<t:${Math.floor(when / 1000)}:R>` : null].filter(Boolean).join(' · ');
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent([`-# ${meta}`, item.description ? `-# ${plainText(item.description, 200)}` : ''].filter(Boolean).join('\n')));
    if (url) {
      card.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setEmoji(emojis.forButton(emojis.PLATFORM[item.platform] ?? '🎵')).setLabel(clip(t(lang, item.type === 'track' ? 'feeds.button.track' : 'feeds.button.release', { platform: platform.name }), 80)),
      ));
    }
    components.push(card);
    return { flags: MessageFlags.IsComponentsV2, components, allowedMentions: allowedMentionsOf(feed) };
  }

  const heading = `${emojis.PLATFORM[item.platform] ?? emojis.PLATFORM.rss} ${url ? `**[${linkText(item.title) || platform.name}](${url})**` : `**${linkText(item.title) || platform.name}**`}`;
  const lines = [heading];
  const description = plainText(item.description, MAX_DESCRIPTION);
  if (description) lines.push(`-# ${description}`);
  if (item.extra) lines.push(`-# ${plainText(item.extra, 160)}`);

  const ended = item.type === 'ended';
  const card = new ContainerBuilder().setAccentColor(ended ? ENDED_COLOR : Number.isInteger(options.color) ? options.color : platform.color);
  if (lines.length === 1) {
    // Only the title: a section with the picture of the account is as tall as the picture and would leave an empty space under one line, so it goes as plain text.
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading));
  } else {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(safeUrl(item.avatar) ?? fallbackPicture(item.platform)));
    card.addSectionComponents(section);
  }

  // A Short is vertical: its picture is a small frame on black bars, so it goes without the big picture unless the server asks for it.
  const wantImage = options.image === true || (options.image !== false && item.type !== 'short');
  const image = wantImage ? safeUrl(item.image) : null;
  if (image) {
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  }

  const when = toMs(item.publishedAt);
  const meta = [`${emojis.TYPE[item.type] ?? ''} ${t(lang, `feeds.type.${item.type}`)}`.trim(), plainText(item.author, 80), when ? `<t:${Math.floor(when / 1000)}:R>` : null].filter(Boolean).join(' · ');
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${meta}`));

  if (ended) {
    // A stream that is over keeps two ways out: the channel, and the replay when the platform has one.
    const buttons = [];
    if (safeUrl(item.authorUrl)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(safeUrl(item.authorUrl)).setLabel(clip(t(lang, 'feeds.button.channel'), 80)));
    if (safeUrl(item.vodUrl)) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(safeUrl(item.vodUrl)).setEmoji(emojis.forButton(emojis.VOD)).setLabel(clip(t(lang, 'feeds.button.replay'), 80)));
    if (buttons.length) card.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
  } else if (options.button && url) {
    card.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(clip(t(lang, `feeds.button.${item.type}`, { platform: platform.name }), 80)),
    ));
  }
  components.push(card);
  return { flags: MessageFlags.IsComponentsV2, components, allowedMentions: allowedMentionsOf(feed) };
}

/** The message ready to send: for a release it carries the picture drawn for it (`files`); for everything else it is `buildFeedMessage`. */
async function buildFeedPayload(feed, item, options = {}) {
  const hero = options.hero === undefined ? await heroFor(item) : options.hero;
  return { ...buildFeedMessage(feed, item, { ...options, hero }), ...(hero ? { files: hero.files } : {}) };
}

module.exports = { buildFeedMessage, buildFeedPayload, renderMessage, pingLine, allowedMentionsOf, VARIABLES };
