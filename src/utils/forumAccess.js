// Forum support: who may use each tool in a post. The author of a post can close it, mark it solved and rename it (each can be turned off by the
// setup); the staff of the setup (its roles) and the members with Manage Threads can do everything else, and the staff can act on any post.
// A staff member that only has a role (not Manage Threads) cannot act on a post of a member whose highest role is above theirs, like the
// moderation commands. Nothing here talks to Discord: it reads the member, the post and the setup it is given.
const { ChannelType, PermissionFlagsBits } = require('discord.js');

/** What a tool needs: `staff`, or `author` (the author, if the setup allows it: the key of the switch) and the staff. */
const POLICY = {
  lock: { who: 'staff' },
  unlock: { who: 'staff' },
  reopen: { who: 'staff' },
  move: { who: 'staff' },
  tag: { who: 'staff' },
  claim: { who: 'staff' },
  unclaim: { who: 'staff' },
  list: { who: 'staff' },
  close: { who: 'author', switch: 'author_can_close' },
  solved: { who: 'author', switch: 'author_can_solve' },
  unsolved: { who: 'author', switch: 'author_can_solve' },
  rename: { who: 'author', switch: 'author_can_rename' },
};

/** Whether a channel is a post of a forum (a thread whose parent is a forum channel). */
function isForumPost(channel) {
  return Boolean(channel?.isThread?.() && channel.parent?.type === ChannelType.GuildForum);
}

const topPosition = (member) => member?.roles?.highest?.position ?? 0;

/**
 * What a member is in a post: `author` (opened it), `moderator` (Manage Threads in the post), `staffByRole` (one of the setup's staff roles) and
 * `staff` (either). `post` is the row of the index when there is one; the thread's owner is the author otherwise.
 */
function rolesIn(member, thread, { setup = null, post = null } = {}) {
  const permissions = thread?.permissionsFor?.(member) ?? member?.permissions;
  const moderator = Boolean(permissions?.has?.(PermissionFlagsBits.ManageThreads)) || Boolean(member?.permissions?.has?.(PermissionFlagsBits.Administrator));
  const staffByRole = (setup?.staff_role_ids ?? []).some((id) => member?.roles?.cache?.has?.(id));
  const authorId = String(post?.author_id ?? thread?.ownerId ?? '');
  return { author: Boolean(authorId) && authorId === String(member?.id), moderator, staffByRole, staff: moderator || staffByRole, authorId };
}

/**
 * Whether `member` may use `tool` in a post: `{ ok: true }` or `{ ok: false, reason }`, the reason being the key of `forums.deny.<reason>`:
 * `staffOnly` (a tool for the staff), `authorOnly` (the author or the staff), `authorOff` (the setup does not let authors do it) and
 * `hierarchy` (the author of the post has a higher role). `authorMember` is the member who opened the post, when known.
 */
function authorize(tool, member, thread, { setup = null, post = null, authorMember = null, guild = null } = {}) {
  const policy = POLICY[tool];
  if (!policy) return { ok: false, reason: 'staffOnly' };
  const who = rolesIn(member, thread, { setup, post });
  if (who.moderator) return { ok: true, who };
  if (who.staffByRole) {
    const owner = guild?.ownerId && guild.ownerId === member.id;
    if (!who.author && !owner && authorMember && topPosition(authorMember) > topPosition(member)) return { ok: false, reason: 'hierarchy', who };
    return { ok: true, who };
  }
  if (policy.who === 'staff') return { ok: false, reason: 'staffOnly', who };
  if (!who.author) return { ok: false, reason: 'authorOnly', who };
  if (setup && setup[policy.switch] === false) return { ok: false, reason: 'authorOff', who };
  return { ok: true, who };
}

module.exports = { POLICY, isForumPost, rolesIn, authorize };
