// The message a feed sends: an optional line of text on top (a ping, and the words the server chose; the feeds of a creator or a channel,
// such as YouTube, Twitch, Kick or Bluesky, say who posted when the server wrote nothing, the automatic ones are only their card), and a Components V2 card. Two layouts:
//
// The image-first card of the feeds of a site (Reddit, Pinterest, Bluesky, Mastodon, Tumblr, Letterboxd, RSS): the account, the post, the picture.
//   ### emoji [the account](its link)
//   **[Title of the post](link)**            (not when it is the name of the account)
//   > the first words of the post             (not for a pin)
//   [ the picture of the post, as large as it comes ]
//   -# u/author • <t:time:f>                  (a pin: `-# Pinterest ∙ owner` under the account, and nothing at the end)
//   [ the button to the post ]
//
// The feeds that post by themselves (animals, pictures by words, the article of the day...): only the picture, with no icon, source, time or button.
//
// The card of a video, a stream or a release:
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
const { imageReady } = require('./picture');

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

// A feed that follows a creator, a channel or a project by name says who posted when its server wrote no words ("Hey everyone! X is live now"); a feed whose content
// comes from anywhere and posts by itself (a subreddit, a board, the daily animals, a puzzle, any RSS) is only its card, which already says what it is.
// Every platform is listed here on purpose (the checks fail for one that is not), so a new platform has to be classified.
const ANNOUNCES = {
  youtube: true, twitch: true, kick: true, bluesky: true, modrinth: true, mastodon: true, tumblr: true, letterboxd: true, spotify: true, deezer: true, applemusic: true, github: true, npm: true, pypi: true, steam: true,
  reddit: false, pinterest: false, rss: false, anilist: false, pokemon: false, wikipedia: false, chess: false, epic: false,
  cat: false, dog: false, fox: false, bird: false, duck: false, capybara: false, bunny: false, animals: false, pictures: false, randommusic: false,
};
const ANNOUNCED_TYPES = new Set(['video', 'short', 'live', 'clip', 'post', 'update', 'project', 'episode', 'release']);

/** Does a platform announce its notices with words of its own when the server wrote none? (the dashboard shows an empty default for the ones that do not) */
const announces = (platform) => ANNOUNCES[platform] === true;

/** "Hey everyone, **name** has published a new video": what a feed of a creator says when its server wrote no words for it. Empty when it does not apply. */
function defaultMessage(feed, item, lang) {
  if (!announces(item.platform) || !ANNOUNCED_TYPES.has(item.type)) return '';
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

// The sites whose posts are drawn image-first (see the top of this file).
const IMAGE_FIRST = new Set(['reddit', 'pinterest', 'bluesky', 'mastodon', 'tumblr', 'letterboxd', 'rss']);
const MAX_QUOTE = 300;
const MAX_LINK = 512; // what Discord takes as the address of a button
const MAX_IMAGE_URL = 2000;
const MAX_CARD_TEXT = 3800; // a Components V2 message holds 4000 characters of text in all (the words above the card count)

/** An address that fits what Discord takes, or null. */
const shortUrl = (value, max = MAX_LINK) => { const url = safeUrl(value); return url && url.length <= max ? url : null; };

/** The picture, the heading, the words and the button of a post of a site, drawn the same for every site. `top` is the text above the card (for the size). */
function imageFirstCard(item, { platform, options, lang, top }) {
  const emoji = emojis.PLATFORM[item.platform] ?? emojis.PLATFORM.rss;
  const sourceText = plainText(item.source || item.author, 200);
  const sourceName = linkText(item.source || item.author) || platform.name;
  const sourceUrl = shortUrl(item.sourceUrl ?? item.authorUrl);
  const url = shortUrl(item.url);
  const pin = item.platform === 'pinterest';

  const head = [`### ${emoji} ${sourceUrl ? `[${sourceName}](${sourceUrl})` : sourceName}`];
  if (pin) head.push(`-# ${platform.name} ∙ ${plainText(item.author, 80) || sourceText}`);

  // The post's own title; when it is the name of the account again (a pin without words, a post without a title) it is not repeated.
  const titleText = plainText(item.title, 200);
  const showTitle = titleText && titleText !== sourceText;
  const titleLine = showTitle ? `**${url ? `[${linkText(item.title)}](${url})` : linkText(item.title)}**` : '';

  // The first words of the post as a quote, unless they are the title again (or a clipped copy of it); a pin shows its picture, not its caption.
  const wanted = pin ? '' : plainText(item.description, MAX_QUOTE);
  const quote = wanted && wanted !== titleText && !titleText.includes(wanted.replace(/…$/, '')) ? `> ${wanted}` : '';

  const when = toMs(item.publishedAt);
  const by = plainText(item.author, 80);
  const byline = pin ? '' : [by && by !== sourceText ? by : '', when ? `<t:${Math.floor(when / 1000)}:f>` : ''].filter(Boolean).join(' • ');

  const image = options.image === false ? null : (ATTACHMENT.test(String(item.image ?? '')) ? item.image : shortUrl(item.image, MAX_IMAGE_URL));
  const button = options.button !== false && url
    ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setEmoji(emojis.forButton(emoji)).setLabel(clip(t(lang, `feeds.button.${item.type}`, { platform: platform.name }), 80))
    : null;

  // A text that would not fit loses its quote first, then the link of its title: the picture and the button are what stays.
  const text = (withQuote, withTitleLink) => [...head, withTitleLink || !url ? titleLine : (showTitle ? `**${linkText(item.title)}**` : ''), withQuote ? quote : ''].filter(Boolean).join('\n');
  let body = text(true, true);
  if (top.length + body.length + byline.length > MAX_CARD_TEXT) body = text(false, true);
  if (top.length + body.length + byline.length > MAX_CARD_TEXT) body = text(false, false);

  const card = new ContainerBuilder().setAccentColor(Number.isInteger(options.color) ? options.color : platform.color);
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(body, MAX_CARD_TEXT - top.length - byline.length)));
  if (image) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  if (byline) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${byline}`));
  if (button) card.addActionRowComponents(new ActionRowBuilder().addComponents(button));
  return card;
}

// The feeds that post by themselves (a picture of an animal, pictures by words, the article of the day, a puzzle, a Pokémon): only the picture in a clean card.
// No icon, no source, no button, no time. The title (as a link) and the first words only for the ones whose source gives real ones; a picture has none.
const AUTO_CARD = new Set(['cat', 'dog', 'fox', 'bird', 'duck', 'capybara', 'bunny', 'animals', 'pictures', 'wikipedia', 'chess', 'pokemon']);
const WITHOUT_WORDS = new Set(['cat', 'dog', 'fox', 'bird', 'duck', 'capybara', 'bunny', 'animals', 'pictures']); // their title is made up, not given by the source

function autoCard(item, { platform, options }) {
  const lines = [];
  if (!WITHOUT_WORDS.has(item.platform)) {
    const title = linkText(item.title);
    const url = shortUrl(item.url);
    if (title) lines.push(`**${url ? `[${title}](${url})` : title}**`);
    const words = plainText(item.description, MAX_QUOTE);
    if (words && words !== plainText(item.title, 200)) lines.push(`> ${words}`);
    if (item.extra) lines.push(`-# ${plainText(item.extra, 160)}`);
  }
  const image = options.image === false ? null : (ATTACHMENT.test(String(item.image ?? '')) ? item.image : shortUrl(item.image, MAX_IMAGE_URL));
  const card = new ContainerBuilder().setAccentColor(Number.isInteger(options.color) ? options.color : platform.color);
  if (lines.length) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(clip(lines.join('\n'), MAX_CARD_TEXT)));
  if (image) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  // A card needs something inside: with no picture and no words (the server turned the picture off) it says what kind of feed it is.
  if (!lines.length && !image) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(platform.name));
  return card;
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

  // The feeds that post by themselves: only the picture.
  if (AUTO_CARD.has(item.platform) && item.type !== 'ended') {
    components.push(autoCard(item, { platform, options }));
    return { flags: MessageFlags.IsComponentsV2, components, allowedMentions: allowedMentionsOf(feed) };
  }

  // The feeds of a site (a subreddit, a board, a blog...): the image-first card.
  if (IMAGE_FIRST.has(item.platform) && item.type !== 'ended') {
    components.push(imageFirstCard(item, { platform, options, lang, top }));
    return { flags: MessageFlags.IsComponentsV2, components, allowedMentions: allowedMentionsOf(feed) };
  }

  const heading = `${emojis.PLATFORM[item.platform] ?? emojis.PLATFORM.rss} ${url ? `**[${linkText(item.title) || platform.name}](${url})**` : `**${linkText(item.title) || platform.name}**`}`;
  const lines = [heading];
  const description = plainText(item.description, MAX_DESCRIPTION);
  if (description) lines.push(`-# ${description}`);
  // A picture says what was searched (in the language of the server) and where it was found, never the title it has on its site.
  const extra = item.platform === 'pictures' && Array.isArray(item.query?.tags)
    ? [t(lang, 'feeds.pictures.searching', { query: queryLabel(item.query.tags, t(lang, 'feeds.pictures.animeStyle'), t(lang, 'feeds.pictures.without', { word: '{word}' })) }), item.source].filter(Boolean).join(' · ')
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
  const shown = await withWorkingImage(file?.item ?? item, options.imageCheck ?? imageReady);
  return { ...buildFeedMessage(feed, shown, { ...options, hero }), ...(files.length ? { files } : {}) };
}

/** A pin comes with the larger file of its picture (`imageFallback` is the small one the feed gave): the larger one is used when it loads, else the small one. */
async function withWorkingImage(item, check) {
  if (!item?.imageFallback || !item.image) return item;
  return (await check(item.image)) ? item : { ...item, image: item.imageFallback };
}

module.exports = { defaultMessage, announces, ANNOUNCES, buildFeedMessage, buildFeedPayload, renderMessage, pingLine, allowedMentionsOf, VARIABLES };
