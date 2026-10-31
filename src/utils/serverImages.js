// The pictures of a server (its icon, banner and invite splash) as a card, the same style as /avatar and /banner: the picture, links to
// it in every size Discord serves, and buttons for each format. Used by `/server icon`, `/server banner` and `/server splash`.
const { infoPayload, noticePayload } = require('./infoCard');
const { COLORS } = require('./colors');
const { t } = require('../i18n');

// The sizes Discord's CDN serves for these pictures (powers of two up to 4096; the smallest ones are too small to be of use).
const SIZES = [128, 256, 512, 1024, 2048, 4096];
const SHOWN_SIZE = 1024;
const BIGGEST = SIZES[SIZES.length - 1];

// `hash` is the id of the picture in the server, `url` asks discord.js for its address, `animated` whether Discord can animate it.
const KINDS = {
  icon: { hash: (guild) => guild.icon, url: (guild, options) => guild.iconURL(options), animated: true },
  banner: { hash: (guild) => guild.banner, url: (guild, options) => guild.bannerURL(options), animated: true },
  splash: { hash: (guild) => guild.splash, url: (guild, options) => guild.splashURL(options), animated: false },
};

/** The address of the picture in a size and a format (`gif` keeps the animation, the others are always still). */
function addressOf(guild, kind, size, extension) {
  return KINDS[kind].url(guild, { size, extension, forceStatic: extension !== 'gif' });
}

/** Whether the picture of the server moves (its id starts with `a_`). */
function isAnimated(guild, kind) {
  return KINDS[kind].animated && String(KINDS[kind].hash(guild) ?? '').startsWith('a_');
}

/** The card of one picture of a server, or a short notice when the server has none. `kind` is `icon`, `banner` or `splash`. */
function serverImagePayload(guild, kind, lang) {
  if (!KINDS[kind].hash(guild)) return noticePayload(t(lang, `info.server.${kind}.none`, { name: guild.name }), COLORS.RED);
  const animated = isAnimated(guild, kind);
  const still = animated ? 'gif' : 'png';
  const shown = addressOf(guild, kind, SHOWN_SIZE, still);
  const sizes = SIZES.map((size) => `[${size}](${addressOf(guild, kind, size, still)})`).join(' · ');
  // The original is the picture as it is kept (a GIF when it moves); the other buttons are the still formats.
  const formats = ['png', 'jpg', 'webp'].filter((extension) => extension !== still);
  return infoPayload({
    accent: null,
    title: t(lang, `info.server.${kind}.title`, { name: guild.name }),
    subtitle: [animated ? t(lang, 'info.server.animated') : null],
    banner: shown,
    sections: [{ lines: [`**${t(lang, 'info.server.sizes')}** ${sizes}`] }],
    footer: t(lang, 'info.card.id', { id: guild.id }),
    buttons: [
      { label: t(lang, 'info.button.openOriginal.button'), url: addressOf(guild, kind, BIGGEST, still) },
      ...formats.map((extension) => ({ label: extension.toUpperCase(), url: addressOf(guild, kind, BIGGEST, extension) })), // i18n-ignore: file formats
    ],
  });
}

module.exports = { SIZES, KINDS, serverImagePayload, addressOf, isAnimated };
