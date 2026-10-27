// An example notice for each platform and kind, for the previews of the dashboard (no network): written in the language of the person looking,
// with the name and picture of the account when they have chosen one. The words are in the catalogs (`feeds.sample.*`).
const { PLATFORMS, fallbackPicture } = require('./platforms');
const { t } = require('../i18n');

const EXTRA = ['live', 'update', 'daily', 'release', 'game'];

/** `account`: { name, avatar, url } of the account the person chose, when there is one. */
function sampleNotice(platform, type, lang, account = null) {
  const word = (key) => t(lang, `feeds.sample.${key}`);
  const name = account?.name ? String(account.name).slice(0, 100) : word('author');
  const titleKey = ['video', 'short', 'live', 'clip', 'post', 'pin', 'update', 'release', 'game', 'daily', 'ended'].includes(type) ? type : 'video';
  return {
    platform, type, id: 'sample', title: word(titleKey), url: account?.url ?? PLATFORMS[platform]?.site ?? 'https://petto.sbs', description: type === 'short' || type === 'ended' ? '' : word('about'),
    image: type === 'short' ? null : 'https://petto.sbs/assets/duck-purple.png', avatar: account?.avatar ?? fallbackPicture(platform), author: name, authorUrl: account?.url ?? null,
    publishedAt: Date.now() - 120_000, extra: EXTRA.includes(type) ? word(`extra.${type}`) : '', vodUrl: type === 'ended' ? account?.url ?? null : null,
  };
}

module.exports = { sampleNotice };
