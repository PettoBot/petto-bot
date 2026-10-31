// Forum support: a post that someone locks or unlocks by hand (the menu of Discord) is kept in the same state, and a post that gets its first tag
// no longer waits for one. Two small writes by primary key, and only when the post changed in one of those two ways.
const { Events, ChannelType } = require('discord.js');
const forumsDb = require('../db/forums');
const { getPrimaryPool } = require('../db/postgres');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ThreadUpdate,
  async execute(oldThread, newThread) {
    if (!newThread.guild || newThread.parent?.type !== ChannelType.GuildForum) return;
    try {
      if (Boolean(oldThread.locked) !== Boolean(newThread.locked)) {
        // The row is only changed when it is kept; the tools of Petto do the same change before this arrives, so then nothing changes.
        if (newThread.locked) await forumsDb.transition(newThread.id, ['open', 'solved'], { status: 'locked' });
        else await getPrimaryPool().query(`update forum_posts set status = case when solved_at is not null then 'solved' else 'open' end where thread_id = $1 and status = 'locked'`, [newThread.id]);
      }
      if (!(oldThread.appliedTags ?? []).length && (newThread.appliedTags ?? []).length) {
        await getPrimaryPool().query('update forum_posts set tag_deadline_at = null where thread_id = $1 and tag_deadline_at is not null', [newThread.id]);
      }
    } catch (error) {
      logger.warn(`Forums: could not follow a change of the post ${newThread.id}: ${error.message}`);
    }
  },
};
