const { MessageFlags } = require('discord.js');
const bulkRoleJobsDb = require('../db/bulkRoleJobs');
const tempRolesDb = require('../db/tempRoles');
const logger = require('./logger');
const { textCard } = require('./caseCard');
const { t, tn, guildLanguage } = require('../i18n');
const { ERROR_CODES, checkTargetRole, classifyMember, matchesFilters, buildCardText, dangerousBits } = require('./bulkRolePlan');

const PAGE_SIZE = 1000; // members Discord gives in one request when the list is read page by page
const SAVE_EVERY = 25; // members between two saves of the progress...
const SAVE_EVERY_MS = 5000; // ...or this long
const CONTROL_EVERY = 10; // members between two looks at the row (cancel, pause)
const CONTROL_EVERY_MS = 2500;
const PAUSE_POLL_MS = 3000;
const MAX_CONSECUTIVE_REFUSALS = 15; // Discord refusing this many in a row (and nothing given in between) means the permission is gone
const MAX_LOGGED_ERRORS = 3; // one line each for the first failures of a job, the rest are counted
const UNKNOWN_MEMBER = 10007; // the member left while the job was running: not a failure

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
const codeOf = (error) => Number(error?.code ?? error?.rawError?.code);

// The reasons a job fails are saved in the database (`error_code`, with the English `error_message` as a fallback) for the dashboard.
async function fail(job, code, extra = {}) {
  await bulkRoleJobsDb.updateJob(job.id, { status: 'failed', error_code: code, error_message: ERROR_CODES[code], finished_at: new Date().toISOString(), ...extra });
}

/**
 * The members of a server in pages of up to 1000, by ascending id, from the member after `after`. They are read page by page (the list of
 * Discord, which is the same order the cursor of a job uses) so a huge server is never asked for whole in one go; when that cannot be done
 * (Discord refuses the list) the full member fetch is used instead and cut into the same pages.
 */
async function* memberPages(guild, after = '0') {
  let cursor = after;
  let usable = true;
  while (usable) {
    let page;
    try {
      page = await guild.members.list({ limit: PAGE_SIZE, after: cursor });
    } catch (error) {
      if (cursor !== after) throw error; // it worked before: this is a real failure
      usable = false;
      break;
    }
    if (!page.size) return;
    const sorted = [...page.values()].sort(byId);
    yield sorted;
    cursor = sorted[sorted.length - 1].id;
    if (page.size < PAGE_SIZE) return;
  }
  const everyone = [...(await guild.members.fetch()).values()].filter((member) => BigInt(member.id) > BigInt(after)).sort(byId);
  for (let i = 0; i < everyone.length; i += PAGE_SIZE) yield everyone.slice(i, i + PAGE_SIZE);
}

/** Edits the message that follows a job started from a command (a job from the dashboard has none). Never throws. */
async function showCard(client, job, lang, patch, dangerous) {
  if (!job.progress_channel_id || !job.progress_message_id) return;
  try {
    const { text, color } = buildCardText(lang, { ...job, ...patch }, { dangerous });
    const channel = await client.channels.fetch(job.progress_channel_id);
    await channel.messages.edit(job.progress_message_id, { components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn(`Bulk role job #${job.id}: the progress message could not be edited: ${error.message}`);
  }
}

/**
 * Runs one bulk-role job to its end (or until it is cancelled), a page of members at a time. Everything it has done is saved with a cursor, so a job that
 * a restart cut goes on from the member where it was (see requeueRunning). Role changes go one member at a time: Discord's own limit for the route paces
 * them, and the job reads the row now and then to see if it was cancelled or paused.
 */
async function processBulkRoleJob(client, job) {
  const guild = await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) return fail(job, 'guild_gone');

  const botMember = await guild.members.fetchMe().catch(() => null);
  const targetRole = await guild.roles.fetch(job.target_role_id).catch(() => null);
  const refusal = checkTargetRole({ guildId: guild.id, role: targetRole, botMember });
  if (refusal) return fail(job, refusal);

  // The job runs on a timer, outside of any server: the audit log, the progress and the notice use the server's language.
  const lang = await guildLanguage(guild.id);
  const dangerous = dangerousBits(targetRole);
  const author = job.started_by ? (client.users.cache.get(job.started_by)?.tag ?? job.started_by) : null;
  const auditReason = (job.reason
    ? t(lang, 'moderation.bulkRole.auditBy', { id: job.id, user: author ?? '?', reason: job.reason })
    : author ? t(lang, 'moderation.bulkRole.auditUser', { id: job.id, user: author }) : t(lang, 'moderation.bulkRole.audit', { id: job.id })).slice(0, 512);

  // Where it is: a job that was cut by a restart already has its counts and the id of the last member it finished.
  const startedAt = job.started_at ?? new Date().toISOString();
  const total = Math.max(guild.memberCount ?? 0, Number(job.total_members ?? 0));
  const state = {
    status: 'running',
    started_at: startedAt,
    total_members: total,
    processed_members: Number(job.processed_members ?? 0),
    success_count: Number(job.success_count ?? 0),
    skipped_count: Number(job.skipped_count ?? 0),
    error_count: Number(job.error_count ?? 0),
  };
  await bulkRoleJobsDb.updateJob(job.id, { status: 'running', started_at: startedAt, total_members: total });
  await showCard(client, job, lang, state, dangerous);

  let cursor = job.cursor_id ?? '0';
  let lastSave = Date.now();
  let lastControl = Date.now();
  let sinceSave = 0;
  let sinceControl = 0;
  let refusals = 0;
  let logged = 0;
  let lastError = null;
  const save = async (extra = {}) => {
    sinceSave = 0;
    lastSave = Date.now();
    const patch = { processed_members: state.processed_members, success_count: state.success_count, skipped_count: state.skipped_count, error_count: state.error_count, cursor_id: cursor, ...extra };
    await bulkRoleJobsDb.updateJob(job.id, patch);
    await showCard(client, job, lang, { ...state, ...extra }, dangerous);
  };

  /** Looks at the row: `cancelled`, or waits while it is paused. */
  const control = async () => {
    sinceControl = 0;
    lastControl = Date.now();
    let fresh = await bulkRoleJobsDb.getJob(job.id).catch(() => null);
    let announcedPause = false;
    while (fresh?.status === 'running' && fresh.paused) {
      if (!announcedPause) { announcedPause = true; await save(); await showCard(client, job, lang, { ...state, paused: true }, dangerous); }
      await sleep(PAUSE_POLL_MS);
      fresh = await bulkRoleJobsDb.getJob(job.id).catch(() => null);
    }
    if (announcedPause) await showCard(client, job, lang, state, dangerous);
    return fresh?.status === 'cancelled';
  };

  try {
    for await (const page of memberPages(guild, cursor)) {
      for (const member of page) {
        if (sinceControl >= CONTROL_EVERY || Date.now() - lastControl >= CONTROL_EVERY_MS) {
          if (await control()) {
            await save({ status: 'cancelled' }).catch(() => {});
            return;
          }
        }
        sinceControl++;
        sinceSave++;
        state.processed_members++;
        cursor = member.id;

        const kind = classifyMember(member, job);
        if (kind === 'noop') state.skipped_count++;
        else if (kind === 'change') {
          if (job.dry_run) {
            state.success_count++;
          } else {
            try {
              if (job.action === 'add') await member.roles.add(job.target_role_id, auditReason);
              else await member.roles.remove(job.target_role_id, auditReason);
              state.success_count++;
              refusals = 0;
              // The role is now given (or taken) for good: a temporary row for it would take it away (or hand it back) later.
              await tempRolesDb.clearTempRoles(guild.id, member.id, [job.target_role_id]).catch(() => {});
            } catch (error) {
              if (codeOf(error) === UNKNOWN_MEMBER) {
                state.skipped_count++;
              } else {
                state.error_count++;
                lastError = error;
                refusals++;
                if (logged < MAX_LOGGED_ERRORS) {
                  logged++;
                  // The error itself (not only its text), so the triage of errors knows what it is: a refusal is the server's to fix.
                  logger.warn(`Bulk role job #${job.id}: failed on member ${member.id}:`, error);
                }
                if (refusals >= MAX_CONSECUTIVE_REFUSALS) {
                  await save();
                  return fail(job, 'permission_lost');
                }
              }
            }
          }
        }

        if (sinceSave >= SAVE_EVERY || Date.now() - lastSave >= SAVE_EVERY_MS) await save();
      }
    }
  } catch (error) {
    logger.error(`Bulk role job #${job.id}: the member list could not be read:`, error);
    await save().catch(() => {});
    return fail(job, 'member_list');
  }

  if (lastError && state.error_count > MAX_LOGGED_ERRORS) logger.warn(`Bulk role job #${job.id}: ${state.error_count} members failed in all; the last one:`, lastError);

  const finishedAt = new Date().toISOString();
  await bulkRoleJobsDb.finishJob(job.id, { status: 'completed', total_members: Math.max(total, state.processed_members), processed_members: state.processed_members, success_count: state.success_count, skipped_count: state.skipped_count, error_count: state.error_count, cursor_id: cursor });
  const finished = await bulkRoleJobsDb.getJob(job.id).catch(() => null);
  if (finished?.status !== 'completed') return;
  await showCard(client, job, lang, { ...state, status: 'completed', total_members: Math.max(total, state.processed_members), finished_at: finishedAt }, dangerous);

  if (job.notify_channel_id && !job.dry_run) {
    const channel = await guild.channels.fetch(job.notify_channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      const vars = { role: `<@&${job.target_role_id}>`, success: state.success_count, count: state.success_count + state.skipped_count + state.error_count };
      const done = tn(lang, `moderation.bulkRole.done.${job.action === 'add' ? 'assigned' : 'removed'}`, vars.count, vars);
      await channel.send({ content: done + (state.error_count > 0 ? t(lang, 'moderation.bulkRole.failed', { count: state.error_count }) : '.'), allowedMentions: { parse: [] } }).catch(() => {});
    }
  }
}

module.exports = { processBulkRoleJob, matchesFilters, memberPages };
