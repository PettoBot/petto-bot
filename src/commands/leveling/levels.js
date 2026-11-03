// /levels: everything about levels in one command (a tidier `/` list: they are found by typing `/levels`). The two things members use are subcommands of
// their own, `rank` (your level and XP, or someone else's) and `leaderboard` (the ranking of the server); the settings of the system are in groups
// (`settings`, `voice`, `reward`, `multiplier`, `event`, `manage`). Each subcommand takes the same options and runs the same code as the old commands
// (utils/umbrella.js): `/levels rank` is `!rank`, `/levels leaderboard` is `!top`, `/levels voice xp` is `!level voice-xp`.
//
// The old commands keep working as they were with the prefix (`!level`, `!xp`, `!rank`, `!top`, `!leaderboard`, `!lb`...), and so do the old words as the first
// word of this one (`!levels voice-xp 5`). They are not slash commands any more.
//
// PERMISSIONS: Discord checks `default_member_permissions` for a whole command, never for one subcommand, so `/levels` is open (everybody uses `rank`
// and `leaderboard`) and every subcommand of a group asks, when it runs, for what `!level` asks (Manage Server), for the slash command and the prefix alike.
const { defineUmbrella } = require('../../utils/umbrella');

const level = (name, sub, legacy = [], subGroup = undefined) => ({ name, wraps: 'level', sub, ...(subGroup ? { subGroup } : {}), legacy });

const SUBCOMMANDS = [
  { name: 'rank', wraps: 'rank' },
  { name: 'leaderboard', wraps: 'top' },
  level('status', 'status'),
  {
    group: 'settings',
    description: 'Turn leveling on or off and change how members earn XP and levels.',
    leaves: [
      level('enable', 'enable', ['enable']),
      level('xp', 'xp', ['xp']),
      level('cooldown', 'cooldown', ['cooldown']),
      level('curve', 'curve', ['curve']),
      level('max-level', 'max-level', ['max-level']),
      level('notify', 'notify', ['notify']),
      level('role-mode', 'role-mode', ['role-mode']),
      level('ignore', 'ignore', ['ignore']),
      level('starting-bonus', 'join', ['join']),
      level('apply-starting-bonus', 'sync-join', ['sync-join']),
      level('rules', 'rules', ['rules']),
      level('rank-style', 'rank-style', ['rank-style']),
    ],
  },
  {
    group: 'voice',
    description: 'The same settings for the XP and levels members earn in voice channels.',
    leaves: [
      level('enable', 'voice-enable', ['voice-enable']),
      level('xp', 'voice-xp', ['voice-xp']),
      level('curve', 'voice-curve', ['voice-curve']),
      level('max-level', 'voice-max-level', ['voice-max-level']),
      level('notify', 'voice-notify', ['voice-notify']),
      level('role-mode', 'voice-role-mode', ['voice-role-mode']),
      level('ignore', 'voice-ignore', ['voice-ignore']),
    ],
  },
  { group: 'reward', wraps: 'level', wrapsGroup: 'reward' },
  { group: 'multiplier', wraps: 'level', wrapsGroup: 'multiplier' },
  { group: 'event', wraps: 'level', wrapsGroup: 'event' },
  {
    group: 'manage',
    description: "Change a member's XP or level by hand, reset it, or give the reward roles the levels have earned.",
    leaves: [
      level('xp', 'xp', [], 'manage'),
      level('level', 'level', [], 'manage'),
      level('sync-roles', 'sync', [], 'manage'),
      level('reset', 'reset', ['reset']),
    ],
  },
];

module.exports = defineUmbrella({
  name: 'levels',
  description: 'Levels and XP: your rank, the leaderboard of the server and the settings of the leveling system.',
  subcommands: SUBCOMMANDS,
});
