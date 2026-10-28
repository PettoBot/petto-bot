// The messages of the music: the card of the song that plays (the picture of `!deezer`, the title, the time, the buttons), the queue and the short notices.
const { StringSelectMenuBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, SectionBuilder, ThumbnailBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { buildSongCard } = require('../imgutils/songCard');
const { linkText, plainText, clip, safeUrl } = require('../feeds/text');
const { textCard } = require('../utils/caseCard');
const logger = require('../utils/logger');
const { t, tn } = require('../i18n');
const icons = require('./icons');

const V2 = MessageFlags.IsComponentsV2;
const FILE_NAME = 'nowplaying.png';
const BAR_WIDTH = 14;
const QUEUE_PAGE = 10;
const BUTTON_PREFIX = 'music';

/** 83000 -> "1:23", 3725000 -> "1:02:05". */
function clock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const BAR_CELLS = 5; // the pieces of the bar are wide: five fit in a line of a phone

/**
 * The bar of progress. With the pieces of the music set: a pill that moves along a track, `[pill][track][track][track][end]`; with a plain set,
 * ▬▬▬🔘▬▬▬▬▬▬▬▬.
 */
function progressBar(position, length, set = icons) {
  if (set.KNOB_CELL) {
    const at = length > 0 ? Math.min(BAR_CELLS - 1, Math.max(0, Math.floor((position / length) * BAR_CELLS))) : 0;
    return Array.from({ length: BAR_CELLS }, (_, index) => (index === at ? set.KNOB_CELL : index === BAR_CELLS - 1 ? set.END_CELL : set.TRACK_CELL)).join('');
  }
  if (!(length > 0)) return set.BAR.repeat(BAR_WIDTH);
  const at = Math.min(BAR_WIDTH - 1, Math.max(0, Math.floor((position / length) * BAR_WIDTH)));
  return set.BAR.repeat(at) + set.KNOB + set.BAR.repeat(BAR_WIDTH - at - 1);
}

const button = (action, emoji, label, { style = ButtonStyle.Secondary, disabled = false } = {}) => new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}:${action}`).setEmoji(emoji).setLabel(label).setStyle(style).setDisabled(disabled);

/** The picture of the song, drawn once (and kept in the item) so the refreshes of the card do not draw it again. */
async function imageOf(item) {
  if (item.image === undefined) {
    try {
      item.image = await buildSongCard({ coverUrl: item.artwork, title: item.title, subtitle: item.author, detail: item.lengthMs ? clock(item.lengthMs) : '', round: false });
    } catch (error) {
      logger.warn(`Music: the picture of a song could not be drawn: ${error?.message ?? error}`);
      item.image = null;
    }
  }
  return item.image;
}

/**
 * The card of the song that plays. `first` sends the picture with it; a refresh leaves the picture the message already has.
 * Returns the payload for `send` or `edit`.
 */
async function nowPlaying(music, lang, { first = false, plain = false } = {}) {
  const item = music.current;
  const ic = plain ? icons.plain : icons; // the plain emojis when the custom ones cannot be shown
  const card = new ContainerBuilder(); // no color on the side: a card of information has none
  const files = [];
  const image = item ? await imageOf(item) : null;
  if (image) {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${FILE_NAME}`)));
    if (first) files.push(new AttachmentBuilder(image, { name: FILE_NAME }));
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  }

  const url = safeUrl(item?.uri);
  const title = `${ic.NOTE} **${url ? `[${linkText(item.title) || '—'}](${url})` : linkText(item?.title) || '—'}**`;
  const position = music.positionMs();
  const details = [
    item?.lengthMs ? `${ic.CLOCK} ${clock(position)} / ${clock(item.lengthMs)}` : `${ic.CLOCK} ${t(lang, 'music.card.live')}`,
    `${ic.VOLUME} ${music.volume}%`,
  ];
  if (music.paused) details.push(`${ic.PAUSE} ${t(lang, 'music.card.paused')}`);
  if (music.loop === 'track') details.push(`${ic.LOOP_TRACK} ${t(lang, 'music.card.loop.track')}`);
  if (music.loop === 'queue') details.push(`${ic.LOOP} ${t(lang, 'music.card.loop.queue')}`);
  const next = music.queue[0];
  if (next) details.push(`${ic.PLAY} ${t(lang, 'music.card.next', { title: clip(plainText(next.title, 80), 80) })}`);

  const lines = [`### ${title}`, plainText(item?.author, 80) || '—', details.join('  ·  ')];
  if (item?.lengthMs) lines.push(progressBar(position, item.lengthMs, ic));
  if (item?.requestedBy) lines.push(`-# ${t(lang, 'music.card.requestedBy', { user: `<@${item.requestedBy}>` })}`);

  if (!image && safeUrl(item?.artwork)) {
    card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n'))).setThumbnailAccessory(new ThumbnailBuilder().setURL(safeUrl(item.artwork))));
  } else {
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const label = (name) => t(lang, `music.btn.${name}`); // a name on each button: the icons alone were not clear
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    button('prev', ic.PREVIOUS, label('prev'), { disabled: !music.history.length }),
    music.paused ? button('pause', ic.PLAY, label('resume')) : button('pause', ic.PAUSE, label('pause')),
    button('stop', ic.STOP, label('stop')),
    button('skip', ic.SKIP, label('skip')),
    button('loop', music.loop === 'track' ? ic.LOOP_TRACK : ic.LOOP, label('loop'), { style: music.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success }),
  ));
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    button('queue', ic.QUEUE, label('queue')),
    button('voldown', ic.VOLUME_DOWN, label('voldown')),
    button('volup', ic.VOLUME, label('volup')),
    button('shuffle', ic.SHUFFLE, label('shuffle')),
    button('leave', ic.LEAVE, label('leave')),
  ));
  const payload = { flags: V2, components: [card], allowedMentions: { parse: [] } };
  if (files.length) payload.files = files; // a refresh leaves the picture the message already has
  return payload;
}

/** The queue, ten songs a page. */
function queuePage(music, lang, page = 1) {
  const pages = Math.max(1, Math.ceil(music.queue.length / QUEUE_PAGE));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const lines = [`### ${icons.QUEUE} ${t(lang, 'music.queue.title')}`];
  if (music.current) lines.push(t(lang, 'music.queue.now', { title: clip(plainText(music.current.title, 80), 80), author: clip(plainText(music.current.author, 50), 50), time: music.current.lengthMs ? clock(music.current.lengthMs) : t(lang, 'music.card.live') }));
  if (!music.queue.length) {
    lines.push(t(lang, 'music.queue.empty'));
  } else {
    const slice = music.queue.slice((at - 1) * QUEUE_PAGE, at * QUEUE_PAGE);
    slice.forEach((item, index) => lines.push(t(lang, 'music.queue.line', { n: (at - 1) * QUEUE_PAGE + index + 1, title: clip(plainText(item.title, 80), 80), author: clip(plainText(item.author, 50), 50), time: item.lengthMs ? clock(item.lengthMs) : t(lang, 'music.card.live') })));
    const rest = music.queue.reduce((sum, item) => sum + (item.lengthMs || 0), 0);
    lines.push(`-# ${tn(lang, 'music.queue.footer', music.queue.length, { page: at, pages, count: music.queue.length, time: clock(rest) })}`);
  }
  return { flags: V2, components: [textCard(lines.join('\n'), null)], allowedMentions: { parse: [] } };
}

const SOURCE_NAMES = { youtube: 'YouTube', soundcloud: 'SoundCloud', deezer: 'Deezer', spotify: 'Spotify', bandcamp: 'Bandcamp' };

/** The results of a search in a menu: the one who searched picks one (`music:pick:<token>`). */
function choiceMenu(items, token, lang) {
  const lines = [`### ${icons.QUEUE} ${t(lang, 'music.search.title')}`, t(lang, 'music.search.hint')];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${BUTTON_PREFIX}:pick:${token}`)
    .setPlaceholder(t(lang, 'music.search.placeholder'))
    .addOptions(items.slice(0, 25).map((item, index) => ({
      label: clip(plainText(item.title, 100) || '—', 100),
      description: clip([plainText(item.author, 60), item.lengthMs ? clock(item.lengthMs) : t(lang, 'music.card.live'), SOURCE_NAMES[item.source] ?? ''].filter(Boolean).join(' · '), 100),
      value: String(index),
    })));
  const box = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
    .addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return { flags: V2, components: [box], allowedMentions: { parse: [] } };
}

/** A short notice in a card (green for good news, red for a problem, no color for the rest). */
const notice = (text, color = null) => ({ flags: V2, components: [textCard(text, color)], allowedMentions: { parse: [] } });

module.exports = { nowPlaying, queuePage, choiceMenu, notice, clock, progressBar, BUTTON_PREFIX, FILE_NAME, QUEUE_PAGE };
