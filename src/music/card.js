// The messages of the music: the card of the song that plays (the picture of `!deezer`, the title, the time, the buttons), the queue and the short notices.
const { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, SectionBuilder, ThumbnailBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
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

/** ▬▬▬🔘▬▬▬▬▬▬▬▬ */
function progressBar(position, length) {
  if (!(length > 0)) return icons.BAR.repeat(BAR_WIDTH);
  const at = Math.min(BAR_WIDTH - 1, Math.max(0, Math.floor((position / length) * BAR_WIDTH)));
  return icons.BAR.repeat(at) + icons.KNOB + icons.BAR.repeat(BAR_WIDTH - at - 1);
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
async function nowPlaying(music, lang, { first = false } = {}) {
  const item = music.current;
  const card = new ContainerBuilder(); // no color on the side: a card of information has none
  const files = [];
  const image = item ? await imageOf(item) : null;
  if (image) {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${FILE_NAME}`)));
    if (first) files.push(new AttachmentBuilder(image, { name: FILE_NAME }));
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  }

  const url = safeUrl(item?.uri);
  const title = `${icons.NOTE} **${url ? `[${linkText(item.title) || '—'}](${url})` : linkText(item?.title) || '—'}**`;
  const position = music.positionMs();
  const details = [
    `${icons.USER} ${plainText(item?.author, 80) || '—'}`,
    item?.lengthMs ? `${icons.CLOCK} ${clock(position)} / ${clock(item.lengthMs)}` : `${icons.CLOCK} ${t(lang, 'music.card.live')}`,
    `${icons.VOLUME} ${music.volume}%`,
  ];
  if (music.paused) details.push(`${icons.PAUSE} ${t(lang, 'music.card.paused')}`);
  if (music.loop === 'track') details.push(`${icons.LOOP_TRACK} ${t(lang, 'music.card.loop.track')}`);
  if (music.loop === 'queue') details.push(`${icons.LOOP} ${t(lang, 'music.card.loop.queue')}`);

  const lines = [`### ${title}`, `-# ${details.join('  ·  ')}`];
  if (item?.lengthMs) lines.push(progressBar(position, item.lengthMs));
  if (item?.requestedBy) lines.push(`-# ${t(lang, 'music.card.requestedBy', { user: `<@${item.requestedBy}>` })}`);
  const next = music.queue[0];
  if (next) lines.push(`-# ${t(lang, 'music.card.next', { title: clip(plainText(next.title, 80), 80) })}`);

  if (!image && safeUrl(item?.artwork)) {
    card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n'))).setThumbnailAccessory(new ThumbnailBuilder().setURL(safeUrl(item.artwork))));
  } else {
    card.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const label = (name) => t(lang, `music.btn.${name}`); // a name on each button: the icons alone were not clear
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    button('prev', icons.PREVIOUS, label('prev'), { disabled: !music.history.length }),
    music.paused ? button('pause', icons.PLAY, label('resume')) : button('pause', icons.PAUSE, label('pause')),
    button('stop', icons.STOP, label('stop')),
    button('skip', icons.SKIP, label('skip')),
    button('loop', music.loop === 'track' ? icons.LOOP_TRACK : icons.LOOP, label('loop'), { style: music.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success }),
  ));
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    button('queue', icons.QUEUE, label('queue')),
    button('voldown', icons.VOLUME_DOWN, label('voldown')),
    button('volup', icons.VOLUME, label('volup')),
    button('shuffle', icons.SHUFFLE, label('shuffle')),
    button('leave', icons.LEAVE, label('leave')),
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

/** A short notice in a card (green for good news, red for a problem, no color for the rest). */
const notice = (text, color = null) => ({ flags: V2, components: [textCard(text, color)], allowedMentions: { parse: [] } });

module.exports = { nowPlaying, queuePage, notice, clock, progressBar, BUTTON_PREFIX, FILE_NAME, QUEUE_PAGE };
