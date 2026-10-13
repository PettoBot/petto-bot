const { createBoardStore } = require('./boardStore');

const DEFAULTS = {
  threshold: 3,
  emoji: '⭐',
  selfstar: false,
  color: 0xffc107,
  timestamp: true,
  jumpurl: true,
  attachments: true,
  ignored_channel_ids: [],
  ignored_role_ids: [],
  ignored_user_ids: [],
};

module.exports = createBoardStore({ configTable: 'starboards', entriesTable: 'starboard_entries', defaults: DEFAULTS });
