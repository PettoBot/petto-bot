// The message a feed sends: an optional line of text on top (a ping and the words the server chose), and a Components V2 card:
//   [ emoji **[Title](link)**            [picture] ]
//   [ -# the description, when there is one       ]
//   ──────────
//   [ the cover picture, when there is one        ]
//   -# the kind of notice · the account · when
// The side bar has the color of the platform. Nothing here reads the network: the services give `item`, and the same builder makes the
// answer of the real feeds, the test of the dashboard and the screenshots of the site.
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { PLATFORMS, fallbackPicture } = require('./platforms');
const emojis = require('./emojis');
const { plainText, linkText, safeUrl, clip, MAX_DESCRIPTION, MAX_TOP } = require('./text');
const { t } = require('../i18n');
const { heroFor } = require('./hero');
const { queryLabel } = require('./providers/pictures');
const { fetchImageBuffer } = require('../utils/safeImage');

/**
 * What a feed knows about one notice. `item`:
 *   platform, type, title, url, description?, image?, avatar?, author?, authorUrl?, publishedAt? (ms or ISO), extra? (a line of its own: the game, the viewers…)
 */


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

// The platforms where a person or a project posts (a channel, a streamer, a project...): without words of its own a feed says who posted and what, so the card is not alone.
// The ones that post on their own (pictures, animals, the Pokémon of the day, free games, music for you, RSS) keep only the card.
const ANNOUNCED = new Set(['youtube', 'twitch', 'kick', 'bluesky', 'pinterest', 'modrinth', 'reddit', 'github', 'npm', 'pypi', 'steam', 'anilist', 'spotify', 'deezer', 'applemusic', 'mastodon', 'tumblr', 'letterboxd']);
const ANNOUNCED_TYPES = new Set(['video', 'short', 'live', 'clip', 'post', 'pin', 'update', 'project', 'episode', 'release']);

/** "Hey everyone, **name** has published a new video": what a feed of an account says when its server wrote no words for it. Empty when it does not apply. */
function defaultMessage(feed, item, lang) {
  if (!ANNOUNCED.has(item.platform) || !ANNOUNCED_TYPES.has(item.type)) return '';
  const name = plainText(item.author || feed.account_name || PLATFORMS[item.platform]?.name || '', 100);
  return name ? t(lang, `feeds.default.${item.type}`, { name: `**${name}**` }) : '';
}

/** The pings of a feed: the roles it names, and `@everyone` when it was asked for. */
function pingLine(feed) {
  const parts = [];
  if (feed.ping_everyone) parts.push('@everyone');
  for (const id of feed.ping_roles ?? []) if (/^\d{15,25}$/.test(String(id))) parts.push(`<@&${id}>`);
  return parts.join(' ');
}

function allowedMentionsOf(feed) {
  // The words of the feed are written by the server, so the users and roles in them are real mentions; what the platforms send has its mentions broken
  // (see `plainText`), so a title or a post cannot ping anyone. `@everyone` only when the feed asks for it.
  return { parse: ['users', 'roles', ...(feed.ping_everyone ? ['everyone'] : [])], repliedUser: false };
}

/**
 * The message of a feed for an item.
 * `feed`: { message, ping_roles, ping_everyone, options: { image, button (on unless false), player (Shorts: on unless false), color } }. `test` puts a small "test" mark on the top line.
 */
function buildFeedMessage(feed, item, { lang, test = false, hero = null } = {}) {
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.rss;
  const options = feed.options ?? {};
  const components = [];

  const written = renderMessage(feed.message, item).trim() || defaultMessage(feed, item, lang);
  const top = [pingLine(feed), clip(written, MAX_TOP), test ? `-# ${emojis.TYPE.ended} ${t(lang, 'feeds.test.badge')}` : '']
    .filter(Boolean).join(' ').trim();
  if (top) components.push(new TextDisplayBuilder().setContent(top));

  const url = safeUrl(item.url);

  // The player of the video, like a person pasting the link: a plain message (Discord draws the playable video itself), not a card. Only for the videos and Shorts of YouTube; a Short comes this way unless the feed says `player: false` (its own picture is a small frame, the player shows the Short itself).
  if ((options.player === true || (item.type === 'short' && options.player !== false)) && item.platform === 'youtube' && (item.type === 'video' || item.type === 'short') && url) {
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
  // A picture says what was searched (in the language of the server) and where it was found, never the title it has on its site.
  const extra = item.platform === 'pictures' && Array.isArray(item.query?.tags)
    ? [t(lang, 'feeds.pictures.searching', { query: queryLabel(item.query.tags, t(lang, 'feeds.pictures.animeStyle')) }), item.source].filter(Boolean).join(' · ')
    : item.extra;
  if (extra) lines.push(`-# ${plainText(extra, 160)}`);

  const ended = item.type === 'ended';
  const card = new ContainerBuilder().setAccentColor(Number.isInteger(options.color) ? options.color : platform.color);
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
  // `attachment://` is a picture sent with the message as a file (see `buildFeedPayload`).
  const image = wantImage ? (ATTACHMENT.test(String(item.image ?? '')) ? item.image : safeUrl(item.image)) : null;
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
  } else if (options.button !== false && url) {
    // On unless the server turned it off: when the title is lost to Discord's formatting, the button still opens the notice.
    card.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setEmoji(emojis.forButton(emojis.PLATFORM[item.platform] ?? emojis.PLATFORM.rss)).setLabel(clip(t(lang, `feeds.button.${item.type}`, { platform: platform.name }), 80)),
    ));
  }
  components.push(card);
  return { flags: MessageFlags.IsComponentsV2, components, allowedMentions: allowedMentionsOf(feed) };
}

const ATTACHMENT = /^attachment:\/\/[\w.-]{1,64}$/;
const REHOST_MAX_BYTES = 8 * 1024 * 1024; // what a bot can send in any server
const EXTENSIONS = [[[0x89, 0x50, 0x4e, 0x47], 'png'], [[0xff, 0xd8, 0xff], 'jpg'], [[0x47, 0x49, 0x46, 0x38], 'gif'], [[0x52, 0x49, 0x46, 0x46], 'webp']];

/**
 * A picture whose link expires or that its site refuses to show elsewhere (`item.rehost`, the feed of pictures) goes with the message as a file, so
 * Discord never shows a broken picture for it. It is downloaded only from public addresses, and only when it is a real PNG, JPEG, GIF or WebP; when it
 * cannot be, the link is used.
 */
async function rehosted(item, download) {
  if (!item?.rehost || !/^https:\/\//i.test(String(item.image ?? ''))) return null;
  try {
    const buffer = await download(item.image, undefined, { maxBytes: REHOST_MAX_BYTES });
    const ext = EXTENSIONS.find(([magic]) => magic.every((byte, i) => buffer[i] === byte))?.[1];
    if (!ext) return null;
    const name = `picture.${ext}`;
    return { item: { ...item, image: `attachment://${name}` }, files: [new AttachmentBuilder(buffer, { name })] };
  } catch {
    return null;
  }
}

/** The message ready to send: for a release it carries the picture drawn for it (`files`), a picture to send as a file goes as one; for everything else it is `buildFeedMessage`. */
async function buildFeedPayload(feed, item, options = {}) {
  const hero = options.hero === undefined ? await heroFor(item) : options.hero;
  const file = hero ? null : await rehosted(item, options.download ?? fetchImageBuffer);
  const files = [...(hero?.files ?? []), ...(file?.files ?? [])];
  return { ...buildFeedMessage(feed, file?.item ?? item, { ...options, hero }), ...(files.length ? { files } : {}) };
}

module.exports = { defaultMessage, buildFeedMessage, buildFeedPayload, renderMessage, pingLine, allowedMentionsOf, VARIABLES };
