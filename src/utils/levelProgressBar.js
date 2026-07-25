const { EMOJI } = require('./emojis');

// A 10-segment bar built from 9 custom emojis (start/middle/end × full/half/empty), same
// structure as bli's — falls back to a plain text bar until those are added to emojis.js
// (see README's "Leveling / rank / leaderboard" section for exactly which 9 to make).
const HAS_CUSTOM_BAR = Boolean(EMOJI.BAR_START_FULL);

function buildProgressBarEmoji(progress) {
  const p = Math.min(100, Math.max(0, progress));
  const seg = {
    start: { full: EMOJI.BAR_START_FULL, half: EMOJI.BAR_START_HALF, empty: EMOJI.BAR_START_EMPTY },
    middle: { full: EMOJI.BAR_MID_FULL, half: EMOJI.BAR_MID_HALF, empty: EMOJI.BAR_MID_EMPTY },
    end: { full: EMOJI.BAR_END_FULL, half: EMOJI.BAR_END_HALF, empty: EMOJI.BAR_END_EMPTY },
  };

  let bar = '';
  for (let i = 0; i < 10; i++) {
    const set = i === 0 ? seg.start : i === 9 ? seg.end : seg.middle;
    if (p >= (i + 1) * 10) bar += set.full;
    else if (p >= i * 10 + 5) bar += set.half;
    else bar += set.empty;
  }
  return bar;
}

function buildProgressBarText(progress, length = 20) {
  const p = Math.min(100, Math.max(0, progress));
  const filled = Math.round((p / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function buildProgressBar(progress) {
  return HAS_CUSTOM_BAR ? buildProgressBarEmoji(progress) : buildProgressBarText(progress);
}

module.exports = { buildProgressBar };
