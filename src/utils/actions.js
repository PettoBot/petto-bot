// The interaction actions of `/act` (hug, pat, slap...): which group each one lives in, the short words that reach it with the
// prefix (`!hug`, `!hf`) and the emoji of its response button. The texts of an action are in the roleplay catalogs
// (`roleplay.<name>.*`) and the descriptions in `cmd.roleplay.act.<group>.<name>.*`.
//
// Discord allows 25 groups in a command and 25 subcommands in a group, so the actions are spread over a few groups.

const GROUPS = [
  { name: 'love', actions: ['hug', 'cuddle', 'kiss', 'airkiss', 'peck', 'handhold', 'nuzzle', 'pat', 'glomp', 'love'] },
  { name: 'play', actions: ['boop', 'poke', 'tickle', 'pinch', 'peek', 'bite', 'lick', 'nom', 'nyah', 'drool', 'yeet', 'bleh', 'wink', 'headbang', 'dance', 'sip'] },
  { name: 'fight', actions: ['slap', 'smack', 'punch', 'kill', 'angry', 'angrystare', 'mad', 'shout', 'baka', 'stare', 'evillaugh', 'smug'] },
  { name: 'feel', actions: ['cry', 'sad', 'happy', 'laugh', 'smile', 'blush', 'shy', 'nervous', 'scared', 'sweat', 'sigh', 'bored', 'tired', 'sleep', 'yawn', 'sneeze', 'sorry', 'pout'] },
  { name: 'react', actions: ['confused', 'think', 'surprised', 'woah', 'shrug', 'facepalm', 'lurk', 'cool', 'hi', 'bye', 'wave', 'highfive', 'brofist', 'handshake', 'yes', 'no', 'nod', 'thumbsup', 'clap', 'slowclap', 'celebrate', 'yay', 'cheers'] },
];

// The words that also reach an action with the prefix (`!hf` is `/act react highfive`).
const ALIASES = {
  brofist: ['bf'], bye: ['goodbye'], handhold: ['hh'], handshake: ['shake'], hi: ['hello'], highfive: ['hf'], laugh: ['lol'],
  no: ['nope'], sad: ['unhappy'], yes: ['agree'], evillaugh: ['evil'], slowclap: ['sclap'], thumbsup: ['thumbs'], facepalm: ['fp'],
};

// The emoji on the button that answers an action (↩️ when an action has none).
const EMOJIS = {
  airkiss: '💋', angry: '😠', angrystare: '😤', baka: '💢', bleh: '😛', blush: '😊', bite: '🦷', boop: '👉', bored: '🥱', brofist: '👊',
  celebrate: '🎉', cheers: '🥂', clap: '👏', confused: '😕', cool: '😎', cuddle: '🫂', cry: '😭', dance: '💃', drool: '🤤', evillaugh: '😈',
  facepalm: '🤦', glomp: '🫂', handshake: '🤝', headbang: '🤘', highfive: '🙌', hi: '👋', hug: '🤗', kiss: '💋', laugh: '😂', love: '💖',
  lurk: '👀', mad: '😡', nervous: '😬', nod: '😌', no: '❌', nuzzle: '🐱', nyah: '🐾', pat: '🫳', peck: '😘', peek: '🫣', pinch: '🤏',
  poke: '👉', pout: '🥺', punch: '🥊', sad: '😭', scared: '😨', shout: '📢', shrug: '🤷', shy: '😳', sigh: '😮‍💨', sip: '🍵', slap: '🖐️',
  sleep: '😴', slowclap: '👏', smack: '🖐️', smile: '😊', smug: '😏', sneeze: '🤧', sorry: '🙏', stare: '👁️', surprised: '😮', sweat: '😅',
  think: '🤔', thumbsup: '👍', tired: '😩', wave: '👋', wink: '😉', woah: '😲', yawn: '🥱', yay: '🥳', yes: '✅',
};

// <descriptions>
// The English description of each action (the builder of /act uses them; the catalogs hold the translations).
const DESCRIPTIONS = {
  hug: 'Give someone a warm hug.',
  cuddle: 'Share a cozy cuddle.',
  kiss: 'Give someone a sweet, non-explicit kiss.',
  airkiss: 'Blow a playful air kiss.',
  peck: 'Give someone a quick, sweet peck.',
  handhold: 'Hold hands with someone.',
  nuzzle: 'Nuzzle someone softly.',
  pat: 'Give someone a gentle pat.',
  glomp: 'Launch a dramatic friendly hug.',
  love: 'Send some love to someone.',
  boop: 'Give someone a tiny boop.',
  poke: 'Poke someone playfully.',
  tickle: 'Tickle someone playfully.',
  pinch: 'Give someone a playful pinch.',
  peek: 'Peek at someone.',
  bite: 'Give someone a playful bite.',
  lick: 'Give someone a silly lick.',
  nom: 'Playfully nom on someone, with a gif.',
  nyah: 'Say nyah like a cat.',
  drool: 'Drool a little, maybe at someone.',
  yeet: 'Pretend to yeet someone in a fictional scene.',
  bleh: 'Stick your tongue out at someone.',
  wink: 'Send a playful wink.',
  headbang: 'Headbang to the music.',
  dance: 'Start a little dance.',
  sip: 'Sip a drink, maybe with someone.',
  slap: 'Give someone a theatrical roleplay slap.',
  smack: 'Give someone a playful smack.',
  punch: 'Throw a harmless fictional punch.',
  kill: 'Pretend to defeat someone in a fictional scene.',
  angry: 'Show playful anger at someone.',
  angrystare: 'Give someone an exaggerated angry stare.',
  mad: 'Show that you are mad.',
  shout: 'Shout, maybe at someone.',
  baka: 'Call someone a baka, playfully.',
  stare: 'Stare, maybe at someone.',
  evillaugh: 'Laugh like a villain.',
  smug: 'Give someone a smug look.',
  cry: 'Share an emotional moment.',
  sad: 'Share a sad moment.',
  happy: 'Share a happy moment.',
  laugh: 'Share a laugh with someone.',
  smile: 'Share a warm smile.',
  blush: 'Blush at someone, with a gif.',
  shy: 'Get shy, maybe around someone.',
  nervous: 'Get nervous, maybe around someone.',
  scared: 'Get scared, maybe of someone.',
  sweat: 'Break into a nervous sweat.',
  sigh: 'Let out a long sigh.',
  bored: 'Show that you are bored.',
  tired: 'Show that you are tired.',
  sleep: 'Go to sleep.',
  yawn: 'Yawn, maybe at someone.',
  sneeze: 'Sneeze, maybe near someone.',
  sorry: 'Say sorry, maybe to someone.',
  pout: 'Pout, maybe at someone.',
  confused: 'Look confused, maybe at someone.',
  think: 'Think hard.',
  surprised: 'Act surprised.',
  woah: 'Gasp in amazement.',
  shrug: 'Shrug it off.',
  facepalm: 'Hide your face in your hand.',
  lurk: 'Lurk quietly in the background.',
  cool: 'Strike a cool pose.',
  hi: 'Say hi to someone.',
  bye: 'Say goodbye to someone.',
  wave: 'Wave hello to someone.',
  highfive: 'Give someone a high five.',
  brofist: 'Share a victorious brofist.',
  handshake: 'Shake hands with someone.',
  yes: 'Give an enthusiastic yes.',
  no: 'Give a playful no.',
  nod: 'Nod in agreement.',
  thumbsup: 'Give a thumbs up.',
  clap: 'Applaud someone.',
  slowclap: 'Give a slow, dramatic clap.',
  celebrate: 'Celebrate something, with someone.',
  yay: 'Get excited.',
  cheers: 'Raise a glass with someone.',
};
// </descriptions>

const COMMAND_NAME = 'act';
const ACTIONS = GROUPS.flatMap((group) => group.actions.map((name) => ({ name, group: group.name, aliases: ALIASES[name] ?? [] })));
const BY_NAME = new Map(ACTIONS.map((action) => [action.name, action]));

/** `{ name, group, aliases }` of an action, or undefined. */
function actionOf(name) {
  return BY_NAME.get(name);
}

/** The prefix routes of every action and alias: `!hug @member` is `!act love hug @member` (see DEFAULT_PREFIX_ROUTES). */
function actionRoutes() {
  return ACTIONS.flatMap((action) => [action.name, ...action.aliases].map((alias) => ({
    alias,
    command: COMMAND_NAME,
    args: [action.group, action.name],
    subcommand: `${action.group} ${action.name}`,
    // `!disablecommand hug` turns off that action only, not all of `/act`.
    disableName: action.name,
  })));
}

module.exports = { COMMAND_NAME, GROUPS, ALIASES, EMOJIS, DESCRIPTIONS, ACTIONS, actionOf, actionRoutes };
