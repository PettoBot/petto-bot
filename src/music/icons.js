// The icons of the music card, its buttons and the status of the voice channel. The custom ones are the `pe_s_*` emojis of the Petto music server (the bot
// is in it, so it can use them anywhere); `plain` has a plain emoji for each one, for when a custom one cannot be shown (the card is sent again with them).
const custom = (name, id) => `<:pe_s_${name}:${id}>`;

const PLAIN = {
  NOTE: '🎵',
  CLOCK: '⏱',
  VOLUME: '🔊',
  VOLUME_DOWN: '🔉',
  PREVIOUS: '⏮',
  PLAY: '▶️',
  PAUSE: '⏸',
  STOP: '⏹',
  SKIP: '⏭',
  LOOP: '🔁',
  LOOP_TRACK: '🔂',
  QUEUE: '📜',
  SHUFFLE: '🔀',
  LEAVE: '👋', // the music set has no icon for this one
  KNOB: '🔘',
  BAR: '▬',
};

const CUSTOM = {
  ...PLAIN,
  NOTE: custom('musicnote', '1564869235774197841'),
  CLOCK: custom('clock', '1564868904013140111'),
  VOLUME: custom('volume', '1564868905347059724'),
  VOLUME_DOWN: custom('volume', '1564868905347059724'),
  PREVIOUS: custom('playprevious', '1564868915295944765'),
  PLAY: custom('play', '1564868907465187399'),
  PAUSE: custom('pause', '1564868917397164072'),
  STOP: custom('stop', '1564868918605250685'),
  SKIP: custom('playnext', '1564868920349950002'),
  LOOP: custom('loop', '1564868924619628674'),
  LOOP_TRACK: custom('loop', '1564868924619628674'),
  QUEUE: custom('queue', '1564868926444408952'),
  SHUFFLE: custom('shuffle', '1564869826290384943'),
};

module.exports = { ...CUSTOM, plain: PLAIN };
