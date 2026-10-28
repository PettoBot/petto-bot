// `/music` and its short forms (`!play`, `!skip`, `!queue`...): songs in a voice channel, from a name, a Spotify link (a song, an album, a playlist), YouTube or
// SoundCloud. The audio comes from the Lavalink node (see the Pettolava repository); what plays is chosen in `src/music/match.js`: no remix and no cover unless
// the person asks for it. While it is tested only the team can use it (MUSIC_PUBLIC).
const { SlashCommandBuilder } = require('discord.js');
const service = require('../../music/service');

const queryOption = (o) => o.setName('query').setDescription('A song and artist, or a link of Spotify (song, album, playlist), YouTube or SoundCloud').setMaxLength(300).setRequired(true);

module.exports = {
  // `!music creep radiohead` is a song; `!music` alone is the queue.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'play' : 'queue'),
  prefixSubcommandAliases: { p: 'play', add: 'play', next: 'playnext', s: 'skip', back: 'previous', prev: 'previous', q: 'queue', list: 'queue', np: 'nowplaying', now: 'nowplaying', vol: 'volume', repeat: 'loop', mix: 'shuffle', jump: 'seek', rm: 'remove', delete: 'remove', disconnect: 'leave', dc: 'leave', unpause: 'resume' },
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Play songs in your voice channel from a name or a link.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('play').setDescription('Play a song or add it to the queue.').addStringOption(queryOption))
    .addSubcommand((s) => s.setName('playnext').setDescription('Add a song to the front of the queue.').addStringOption(queryOption))
    .addSubcommand((s) => s.setName('skip').setDescription('Skip the song that is playing.')
      .addIntegerOption((o) => o.setName('count').setDescription('How many songs to skip (default 1)').setMinValue(1).setMaxValue(50).setRequired(false)))
    .addSubcommand((s) => s.setName('previous').setDescription('Go back to the previous song.'))
    .addSubcommand((s) => s.setName('stop').setDescription('Stop the music and clear the queue.'))
    .addSubcommand((s) => s.setName('pause').setDescription('Pause the song.'))
    .addSubcommand((s) => s.setName('resume').setDescription('Resume the song.'))
    .addSubcommand((s) => s.setName('queue').setDescription('Show the songs that are waiting.')
      .addIntegerOption((o) => o.setName('page').setDescription('The page of the queue').setMinValue(1).setRequired(false)))
    .addSubcommand((s) => s.setName('nowplaying').setDescription('Show the card of the song that is playing.'))
    .addSubcommand((s) => s.setName('volume').setDescription('Change the volume.')
      .addIntegerOption((o) => o.setName('percent').setDescription('From 1 to 150 (100 is normal)').setMinValue(1).setMaxValue(150).setRequired(true)))
    .addSubcommand((s) => s.setName('loop').setDescription('Repeat the song or the whole queue.')
      .addStringOption((o) => o.setName('mode').setDescription('What to repeat').setRequired(true).addChoices({ name: 'off', value: 'off' }, { name: 'song', value: 'track' }, { name: 'queue', value: 'queue' })))
    .addSubcommand((s) => s.setName('shuffle').setDescription('Shuffle the queue.'))
    .addSubcommand((s) => s.setName('seek').setDescription('Jump to a moment of the song.')
      .addStringOption((o) => o.setName('time').setDescription('For example 1:30 or 90').setMaxLength(12).setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take a song out of the queue.')
      .addIntegerOption((o) => o.setName('position').setDescription('Its place in the queue (see the queue)').setMinValue(1).setRequired(true)))
    .addSubcommand((s) => s.setName('clear').setDescription('Empty the queue (the song that plays keeps playing).'))
    .addSubcommand((s) => s.setName('leave').setDescription('Leave the voice channel.')),

  async execute(interaction) {
    const options = interaction.options;
    switch (options.getSubcommand()) {
      case 'play': return service.play(interaction, options.getString('query', true));
      case 'playnext': return service.play(interaction, options.getString('query', true), { next: true });
      case 'skip': return service.command(interaction, 'skip', { count: options.getInteger('count') ?? 1 });
      case 'previous': return service.command(interaction, 'previous');
      case 'stop': return service.command(interaction, 'stop');
      case 'pause': return service.command(interaction, 'pause');
      case 'resume': return service.command(interaction, 'resume');
      case 'queue': return service.command(interaction, 'queue', { page: options.getInteger('page') ?? 1 });
      case 'nowplaying': return service.command(interaction, 'now');
      case 'volume': return service.command(interaction, 'volume', { value: options.getInteger('percent', true) });
      case 'loop': return service.command(interaction, 'loop', { mode: options.getString('mode', true) });
      case 'shuffle': return service.command(interaction, 'shuffle');
      case 'seek': return service.command(interaction, 'seek', { time: options.getString('time', true) });
      case 'remove': return service.command(interaction, 'remove', { place: options.getInteger('position', true) });
      case 'clear': return service.command(interaction, 'clear');
      case 'leave': return service.command(interaction, 'leave');
      default: return null;
    }
  },
};
