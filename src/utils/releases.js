// The releases shown by `!version`, newest first. This file holds what is not text: the version, how it is displayed, the
// codename (never translated), the date, the accent color, the status (`latest` for the first one, `published` for the rest)
// and the emoji of each section. What people read (label, summary, section titles and items) lives in
// src/i18n/releases/<lang>.js, one entry per version with the same sections in the same order.
//
// A new release: add it at the top here (and turn the previous `latest` into `published`), then write it in
// src/i18n/releases/en.js, es.js and pt-BR.js. `node scripts/check-releases.js` fails until the three languages have it.
const { EMOJI } = require('./emojis');
const { t, currentLanguage, normalizeLanguage } = require('../i18n');

const RELEASES = [
  {
    version: 'v0.7.10',
    display: 'v0.7.10',
    name: 'Churro', // i18n-ignore: codename, never translated
    date: '2026-10-30',
    accent: 0xf2c48d,
    status: 'latest',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC],
  },
  {
    version: 'v0.7.9-1',
    display: 'v0.7.9~1',
    name: 'Donut', // i18n-ignore: codename, never translated
    date: '2026-10-29',
    accent: 0xe8b4d8,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.9',
    display: 'v0.7.9',
    name: 'Donut', // i18n-ignore: codename, never translated
    date: '2026-10-29',
    accent: 0xe8b4d8,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_EYES, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.8',
    display: 'v0.7.8',
    name: 'Mochi', // i18n-ignore: codename, never translated
    date: '2026-10-23',
    accent: 0xf7b6c8,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_LOCKED, EMOJI.RELEASE_EYES, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.7',
    display: 'v0.7.7',
    name: 'Tiramisu', // i18n-ignore: codename, never translated
    date: '2026-10-19',
    accent: 0xf3c98b,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_LOCKED, EMOJI.RELEASE_EYES, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.6',
    display: 'v0.7.6',
    name: 'Macaron', // i18n-ignore: codename, never translated
    date: '2026-10-15',
    accent: 0xf0a88f,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_LOCKED, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.5',
    display: 'v0.7.5',
    name: 'Waffle', // i18n-ignore: codename, never translated
    date: '2026-10-13',
    accent: 0xf3c98b,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_EYES, EMOJI.RELEASE_SETTINGS],
  },
  {
    version: 'v0.7.4',
    display: 'v0.7.4',
    name: 'Brownie', // i18n-ignore: codename, never translated
    date: '2026-10-10',
    accent: 0xf0a88f,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_EYES, EMOJI.RELEASE_SETTINGS],
  },
  {
    version: 'v0.7.3',
    display: 'v0.7.3',
    name: 'Flan', // i18n-ignore: codename, never translated
    date: '2026-10-08',
    accent: 0xffe3a3,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_RELOAD, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.2',
    display: 'v0.7.2',
    name: 'Churro', // i18n-ignore: codename, never translated
    date: '2026-10-07',
    accent: 0xffc58a,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.1-2',
    display: 'v0.7.1~2',
    name: 'Boba', // i18n-ignore: codename, never translated
    date: '2026-10-05',
    accent: 0xe7c4ff,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.1-1',
    display: 'v0.7.1~1',
    name: 'Mochi', // i18n-ignore: codename, never translated
    date: '2026-10-05',
    accent: 0xffb3d1,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_EXPERIENCE],
  },
  {
    version: 'v0.7.1',
    name: 'Pudding', // i18n-ignore: codename, never translated
    date: '2026-10-03',
    accent: 0xff91c2,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_EXPERIENCE, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.7.0',
    name: 'Macaron', // i18n-ignore: codename, never translated
    date: '2026-10-03',
    accent: 0xff91c2,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_PC, EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_EXPERIENCE, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.6.1',
    name: 'Taiyaki', // i18n-ignore: codename, never translated
    date: '2026-10-02',
    accent: 0xff91c2,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_EXPERIENCE, EMOJI.RELEASE_MAGIC, EMOJI.HAMMER, EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_SETTINGS, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.6.0',
    name: 'Dango', // i18n-ignore: codename, never translated
    date: '2026-09-30',
    accent: 0x8c7cff,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_LINK, EMOJI.RELEASE_SETTINGS],
  },
  {
    version: 'v0.5.1-46',
    name: 'Cupcake', // i18n-ignore: codename, never translated
    date: '2026-09-24',
    accent: 0x8c7cff,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_BUG, EMOJI.RELEASE_LOCKED, EMOJI.RELEASE_SETTINGS, EMOJI.HAMMER, EMOJI.RELEASE_MAGIC],
  },
  {
    version: 'v0.5.0',
    name: 'Churro', // i18n-ignore: codename, never translated
    date: '2026-08-31',
    accent: 0x5eead4,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_LINK, EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_BUG],
  },
  {
    version: 'v0.4.1',
    name: 'Waffle', // i18n-ignore: codename, never translated
    date: '2026-08-26',
    accent: 0xfe6465,
    status: 'published',
    sectionEmojis: [EMOJI.REPORT, EMOJI.RELEASE_BUG, EMOJI.RELEASE_EYES],
  },
  {
    version: 'v0.4.0',
    name: 'Crepe', // i18n-ignore: codename, never translated
    date: '2026-08-24',
    accent: 0x8c7cff,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_ROCKET, EMOJI.RELEASE_LOCKED, EMOJI.RELEASE_MAGIC],
  },
  {
    version: 'v0.3.0-2',
    name: 'Biscuit', // i18n-ignore: codename, never translated
    date: '2026-08-22',
    accent: 0x4b4f59,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_METAL, EMOJI.RELEASE_NOTE],
  },
  {
    version: 'v0.3.0-1',
    name: 'Cookie', // i18n-ignore: codename, never translated
    date: '2026-08-13',
    accent: 0x5c8dff,
    status: 'published',
    sectionEmojis: [EMOJI.RELEASE_MAGIC, EMOJI.RELEASE_LINK],
  },
];

const RELEASE_TEXTS = {
  en: require('../i18n/releases/en'),
  es: require('../i18n/releases/es'),
  'pt-BR': require('../i18n/releases/pt-BR'),
};

const STATUS_KEYS = { latest: 'info.version.status.latest', published: 'info.version.status.published' };

/** The texts of a release in `lang`; the English ones when that language does not have this release (or not all its sections). */
function releaseTexts(release, lang) {
  const texts = RELEASE_TEXTS[normalizeLanguage(lang) ?? 'en']?.[release.version];
  if (texts && texts.sections?.length === release.sectionEmojis.length) return texts;
  return RELEASE_TEXTS.en[release.version];
}

/** A release with its texts in `lang`: `label`, `status`, `summary` and `sections` ({ title, items }) ready to show. */
function localizeRelease(release, lang = currentLanguage()) {
  const texts = releaseTexts(release, lang);
  const { sectionEmojis, status, ...fields } = release;
  return {
    ...fields,
    label: texts.label,
    status: t(lang, STATUS_KEYS[status], { emoji: EMOJI.RELEASE_APPROVED }),
    summary: texts.summary,
    sections: texts.sections.map((section, index) => ({ title: `${sectionEmojis[index]} ${section.title}`, items: [...section.items] })),
  };
}

function getReleases(lang = currentLanguage()) {
  return RELEASES.map((release) => localizeRelease(release, lang));
}

function getRelease(version, lang = currentLanguage()) {
  const release = RELEASES.find((entry) => entry.version === version);
  return release ? localizeRelease(release, lang) : null;
}

function getLatestRelease(lang = currentLanguage()) {
  return localizeRelease(RELEASES[0], lang);
}

function getReleaseIndex(version) {
  const index = RELEASES.findIndex((release) => release.version === version);
  return index === -1 ? 0 : index;
}

module.exports = { RELEASES, RELEASE_TEXTS, getReleases, getRelease, getLatestRelease, getReleaseIndex };
