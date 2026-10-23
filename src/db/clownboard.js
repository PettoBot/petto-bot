const { createBoardStore } = require('./boardStore');

// The starboard's cousin for the messages that make the server laugh at someone: its own emoji (🤡), color and posts.
const DEFAULTS = {
  threshold: 3,
  emoji: '🤡',
  extra_emojis: [],
  selfstar: false,
  color: 0xe8594f,
  timestamp: true,
  jumpurl: true,
  attachments: true,
  ignored_channel_ids: [],
  ignored_role_ids: [],
  ignored_user_ids: [],
};

module.exports = createBoardStore({ configTable: 'clownboards', entriesTable: 'clownboard_entries', defaults: DEFAULTS });
