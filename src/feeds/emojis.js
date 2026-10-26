// The emojis of the feeds. Until the application emojis (`pe_f_*`) are uploaded, each one is a plain emoji; to use the real one, write its
// `<:pe_f_youtube:ID>` here and nothing else changes.
const PLATFORM = {
  youtube: '<:pe_f_youtube:1564404645802147990>',
  twitch: '<:pe_f_twitch:1564404646737612862>',
  kick: '<:pe_f_kick:1564404648176255108>',
  bluesky: '<:pe_f_BlueSky:1564404649564573876>',
  pinterest: '<:pe_f_pinterest:1564406561328070656>',
  modrinth: '<:pe_f_modrinth:1564404650755751997>',
  pokemon: '<:pe_f_pokemon:1564406028442017973>',
  rss: '<:pe_f_rss:1564405447048298647>',
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
  video: '<:pe_f_video_short:1564405498906812426>',
  short: '<:pe_f_video_short:1564405498906812426>', // the same picture as a video: there is no Short one yet
  live: '<:pe_f_live:1564405931364843602>',
  clip: '<:pe_f_clip:1564404652496134294>',
  post: '<:pe_f_post:1564405577092964444>',
  pin: '<:pe_f_pin:1564404654643879966>',
  update: '<:pe_f_update:1564405656780275852>',
  episode: '📺',
  daily: '🎲',
  ended: '⚫',
};

const BELL = '<a:pe_f_bell:1564404666777997383>';
const VOD = '<:pe_f_vod:1564405376152244306>'; // the replay button of a stream that ended

/** The emoji of a button from its written form (`<:name:id>`, `<a:name:id>` or a plain emoji). */
function forButton(text) {
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(String(text));
  return custom ? { id: custom[3], name: custom[2], animated: custom[1] === 'a' } : { name: String(text) };
}

module.exports = { PLATFORM, TYPE, BELL, VOD, forButton };
