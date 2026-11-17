// The rules of a bulk role job, with nothing that talks to Discord or the database, so they can be checked on their own:
//   - which members a job is for (`classifyMember`), and what it has to do for each one;
//   - whether the role can be given at all (`checkTargetRole`), as a code that the bot and the dashboard each show in their own words;
//   - the joined-after / joined-before dates people type (`parseJoinedInput`), the permissions that make a role risky to hand out in bulk,
//     the time that is left (`etaMs`) and the text of the card that follows a job (`buildCardText`).
const { PermissionFlagsBits } = require('discord.js');
const { parseDuration, formatDuration } = require('./duration');
const { permissionLabels } = require('./permissions');
const { EMOJI } = require('./emojis');
const { t } = require('../i18n');

/** Why a job cannot run. The dashboard has the same codes (`bulkRoleErrors` there) and the text is saved in English as a fallback. */
const ERROR_CODES = Object.freeze({
  guild_gone: "Petto isn't in that server anymore.", // i18n-ignore: saved in the database, English like before
  missing_permission: 'Petto is missing the Manage Roles permission.', // i18n-ignore: saved in the database
  role_gone: 'That role no longer exists.', // i18n-ignore: saved in the database
  role_everyone: '@everyone cannot be given or taken away.', // i18n-ignore: saved in the database
  role_managed: 'That role is managed by an integration, so Discord does not let anyone give it.', // i18n-ignore: saved in the database
  role_above_bot: "That role is above Petto's highest role, move Petto's role above it and try again.", // i18n-ignore: saved in the database
  member_list: "Couldn't load the member list, try again.", // i18n-ignore: saved in the database
  roles_unavailable: "Couldn't load the roles of the server, try again.", // i18n-ignore: saved in the database
  permission_lost: 'Discord kept refusing: Petto lost the permission (or the role moved above it) while the job was running.', // i18n-ignore: saved in the database
  crashed: 'The job stopped because of an unexpected error.', // i18n-ignore: saved in the database
});

/** The permissions that make a role risky to give to a lot of people at once. */
const DANGEROUS_PERMISSIONS = Object.freeze([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
]);
const DANGEROUS_MASK = DANGEROUS_PERMISSIONS.reduce((mask, flag) => mask | flag, 0n);

/** The risky permissions of a role as a bit field (0n when it has none). */
function dangerousBits(role) {
  return BigInt(role?.permissions?.bitfield ?? role?.permissions ?? 0n) & DANGEROUS_MASK;
}

/** Whether the job can be run for this role: `null`, or the code of the reason it cannot. */
function checkTargetRole({ guildId, role, botMember }) {
  // The permissions of a member are added up from the roles the server has loaded, @everyone included: while that list is empty (the server just
  // came back, or Discord is slow) reading them throws, so the job says the roles could not be read instead of stopping with an error.
  if (botMember?.guild && !botMember.guild.roles?.everyone) return 'roles_unavailable';
  let canManage;
  try { canManage = botMember?.permissions?.has(PermissionFlagsBits.ManageRoles); } catch { return 'roles_unavailable'; }
  if (!canManage) return 'missing_permission';
  if (!role) return 'role_gone';
  if (role.id === guildId) return 'role_everyone';
  if (role.managed) return 'role_managed';
  if (role.position >= botMember.roles.highest.position) return 'role_above_bot';
  return null;
}

/** The number of roles of a member, not counting @everyone. */
function roleCount(member) {
  return Math.max(0, (member.roles?.cache?.size ?? 1) - 1);
}

/** Whether the filters of the job (who, roles held, join date, number of roles, pending) include this member. */
function matchesFilters(member, job) {
  if (job.member_type === 'bots' && !member.user.bot) return false;
  if (job.member_type === 'humans' && member.user.bot) return false;
  if (job.skip_pending && member.pending === true) return false;

  if (job.filter_role_ids?.length) {
    const has = job.filter_mode === 'all'
      ? job.filter_role_ids.every((id) => member.roles.cache.has(id))
      : job.filter_role_ids.some((id) => member.roles.cache.has(id));
    if (has === job.filter_exclude) return false;
  }

  const count = roleCount(member);
  if (job.min_roles != null && count < job.min_roles) return false;
  if (job.max_roles != null && count > job.max_roles) return false;

  if (job.joined_after && (!member.joinedTimestamp || member.joinedTimestamp < new Date(job.joined_after).getTime())) return false;
  if (job.joined_before && (!member.joinedTimestamp || member.joinedTimestamp > new Date(job.joined_before).getTime())) return false;

  return true;
}

/** `filtered` (not for this job), `noop` (already as the job wants it) or `change` (the role has to be given or taken away). */
function classifyMember(member, job) {
  if (!matchesFilters(member, job)) return 'filtered';
  const has = member.roles.cache.has(job.target_role_id);
  return (job.action === 'add' ? has : !has) ? 'noop' : 'change';
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * What is typed for "joined after" and "joined before": a day (`2025-03-01`, from midnight UTC) or a length of time back from now (`30d` is 30
 * days ago). Returns the ISO date, `null` when nothing was typed, or `undefined` when it cannot be read.
 */
function parseJoinedInput(text, now = Date.now()) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const day = DAY_RE.exec(value);
  if (day) {
    const stamp = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    const check = new Date(stamp);
    if (Number.isNaN(stamp) || check.getUTCFullYear() !== Number(day[1]) || check.getUTCMonth() !== Number(day[2]) - 1 || check.getUTCDate() !== Number(day[3])) return undefined;
    return check.toISOString();
  }
  const span = parseDuration(value);
  return span ? new Date(now - span).toISOString() : undefined;
}

// Discord lets a bot give or take about ten roles every ten seconds on a server: that is what the estimate starts from, until the job has measured its own pace.
const CHANGES_PER_SECOND = 1;

/**
 * The time that is left, in milliseconds. With the count of who needs a change (`plan_todo`, made before the job starts) it is the changes that are left at the pace
 * of the job (the one it has measured after a few changes, or Discord's own limit at first); without it, from what has been checked so far. `null` while there is too little to tell.
 */
function etaMs(job, now = Date.now()) {
  if (job.plan_todo != null) {
    const changed = Number(job.success_count ?? 0);
    const left = Math.max(0, Number(job.plan_todo) - changed - Number(job.error_count ?? 0));
    if (!left) return 0;
    const started = job.changes_started_at ? new Date(job.changes_started_at).getTime() : NaN;
    const elapsed = (now - started) / 1000;
    const rate = Number.isFinite(started) && changed >= 5 && elapsed > 0 ? changed / elapsed : CHANGES_PER_SECOND;
    return Math.round((left / Math.max(rate, 0.05)) * 1000);
  }
  const started = job.started_at ? new Date(job.started_at).getTime() : NaN;
  const done = Number(job.processed_members ?? 0);
  const total = Number(job.total_members ?? 0);
  if (!Number.isFinite(started) || done < 20 || total <= done) return null;
  return Math.max(0, Math.round(((now - started) / done) * (total - done)));
}

const COLOR = { ok: 0xa5ea7a, wait: 0xfed53c, bad: 0xfe6465, none: 0x4b4f59 };

/** The text of the card of a job, and its color, for a language. `job` is a row of `bulk_role_jobs`; `dangerous` the risky permissions of the role (`dangerousBits`). */
function buildCardText(lang, job, { now = Date.now(), dangerous = 0n } = {}) {
  const role = `<@&${job.target_role_id}>`;
  const preview = Boolean(job.dry_run);
  const status = job.paused && job.status === 'running' ? 'paused' : job.status;
  const what = t(lang, `moderation.bulkRole.card.what.${preview ? 'preview.' : ''}${job.action === 'add' ? 'add' : 'remove'}`, { role });
  const emoji = status === 'completed' ? EMOJI.APPROVE : status === 'failed' || status === 'cancelled' ? EMOJI.DENY : EMOJI.WARNING;
  const lines = [`${emoji}  **${what}** · ${t(lang, `moderation.bulkRole.card.state.${status}`)}`];

  const done = Number(job.processed_members ?? 0);
  const total = Math.max(Number(job.total_members ?? 0), done);
  const changed = Number(job.success_count ?? 0);
  const skipped = Number(job.skipped_count ?? 0);
  const failed = Number(job.error_count ?? 0);
  const filtered = Math.max(0, done - changed - skipped - failed);

  if (status === 'failed') {
    lines.push(t(lang, `moderation.bulkRole.card.error.${job.error_code && ERROR_CODES[job.error_code] ? job.error_code : 'generic'}`, { text: job.error_message ?? '' }));
  }
  if (job.planning && ['pending', 'running'].includes(status)) lines.push(t(lang, 'moderation.bulkRole.card.counting'));
  if (job.plan_todo != null) lines.push(t(lang, 'moderation.bulkRole.card.plan', { total: Number(job.plan_total ?? 0), withRole: Number(job.plan_with_role ?? 0), todo: Number(job.plan_todo) }));
  if (status !== 'failed' || done > 0) lines.push(t(lang, 'moderation.bulkRole.card.progress', { done, total }));
  if (preview) {
    lines.push(t(lang, 'moderation.bulkRole.card.previewCounts', { changed, skipped, filtered }));
  } else if (done > 0) {
    lines.push(t(lang, 'moderation.bulkRole.card.counts', { changed, skipped, failed }));
  }
  if (status === 'running' || status === 'pending') {
    const left = etaMs(job, now);
    if (left !== null && left > 0) lines.push(t(lang, 'moderation.bulkRole.card.eta', { time: formatDuration(Math.max(1000, left), lang) }));
  }
  if (['completed', 'cancelled', 'failed'].includes(status) && job.started_at && job.finished_at) {
    const took = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
    if (took >= 1000) lines.push(t(lang, 'moderation.bulkRole.card.took', { time: formatDuration(took, lang) }));
  }
  if (status === 'completed' && !preview && changed === 0 && failed === 0) lines.push(t(lang, 'moderation.bulkRole.card.nothing'));
  if (job.reason) lines.push(t(lang, 'moderation.bulkRole.card.reason', { reason: String(job.reason).slice(0, 200) }));
  if (job.action === 'add' && dangerous) lines.push(t(lang, 'moderation.bulkRole.card.dangerous', { emoji: EMOJI.WARNING, list: permissionLabels(dangerous, lang) }));
  if (status === 'completed' && preview) lines.push(t(lang, 'moderation.bulkRole.card.previewHint'));
  if (['pending', 'running', 'paused'].includes(status)) lines.push(t(lang, 'moderation.bulkRole.card.hint'));

  const color = status === 'completed' ? COLOR.ok : status === 'failed' ? COLOR.bad : status === 'cancelled' ? COLOR.none : COLOR.wait;
  return { text: lines.join('\n'), color };
}

module.exports = {
  CHANGES_PER_SECOND, ERROR_CODES, DANGEROUS_PERMISSIONS, DANGEROUS_MASK, dangerousBits, checkTargetRole, roleCount, matchesFilters, classifyMember, parseJoinedInput, etaMs, buildCardText,
};
