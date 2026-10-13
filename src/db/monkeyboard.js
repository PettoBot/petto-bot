const { createBoardStore } = require('./boardStore');

// Everything the starboard has, with its own emoji and color: the monkey is what goes where the star would.
const DEFAULTS = {
  threshold: 3,
  emoji: '🐵',
  selfstar: false,
  color: 0x8b5a2b,
  timestamp: true,
  jumpurl: true,
  attachments: true,
  ignored_channel_ids: [],
  ignored_role_ids: [],
  ignored_user_ids: [],
};

module.exports = createBoardStore({ configTable: 'monkeyboards', entriesTable: 'monkeyboard_entries', defaults: DEFAULTS });
