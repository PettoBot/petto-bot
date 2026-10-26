// The emojis of the feeds. Until the application emojis (`pe_f_*`) are uploaded, each one is a plain emoji; to use the real one, write its
// `<:pe_f_youtube:ID>` here and nothing else changes.
const PLATFORM = {
  youtube: '▶️',
  twitch: '🟣',
  kick: '🟢',
  bluesky: '🦋',
  pinterest: '📌',
  modrinth: '🧱',
  pokemon: '⚪',
  rss: '📰',
  reddit: '🟠',
  github: '🐙',
  npm: '📦',
  pypi: '🐍',
  steam: '🎮',
  anilist: '🍥',
  wikipedia: '📖',
  chess: '♟️',
};

const TYPE = {
  video: '🎬',
  short: '📱',
  live: '🔴',
  clip: '✂️',
  post: '💬',
  pin: '📌',
  update: '⬆️',
  episode: '📺',
  daily: '🎲',
  ended: '⚫',
};

const BELL = '🔔';

module.exports = { PLATFORM, TYPE, BELL };
