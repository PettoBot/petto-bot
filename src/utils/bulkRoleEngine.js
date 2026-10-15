const { PermissionFlagsBits } = require('discord.js');
const bulkRoleJobsDb = require('../db/bulkRoleJobs');
const logger = require('./logger');
const { t, tn, guildLanguage } = require('../i18n');

const PROGRESS_SAVE_EVERY = 25;
const CANCEL_CHECK_EVERY = 10;

function matchesFilters(member, job) {
  if (job.member_type === 'bots' && !member.user.bot) return false;
  if (job.member_type === 'humans' && member.user.bot) return false;

  if (job.filter_role_ids?.length) {
    const has = job.filter_mode === 'all'
      ? job.filter_role_ids.every((id) => member.roles.cache.has(id))
      : job.filter_role_ids.some((id) => member.roles.cache.has(id));
    if (has === job.filter_exclude) return false;
  }

  if (job.joined_after && (!member.joinedTimestamp || member.joinedTimestamp < new Date(job.joined_after).getTime())) return false;
  if (job.joined_before && (!member.joinedTimestamp || member.joinedTimestamp > new Date(job.joined_before).getTime())) return false;

  return true;
}

// The reasons a job fails are saved in the database (`error_message`) for the dashboard, in English like before.
async function fail(job, message) {
  await bulkRoleJobsDb.updateJob(job.id, { status: 'failed', error_message: message, finished_at: new Date().toISOString() });
}

/** Runs one bulk-role job to completion (or until cancelled), applied member-by-member so Discord's own per-route rate limiting paces it naturally, no manual throttling needed. */
async function processBulkRoleJob(client, job) {
  const guild = await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) return fail(job, "Petto isn't in that server anymore."); // i18n-ignore: saved in the database

  const botMember = await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return fail(job, 'Petto is missing the Manage Roles permission.'); // i18n-ignore: saved in the database

  const targetRole = await guild.roles.fetch(job.target_role_id).catch(() => null);
  if (!targetRole) return fail(job, 'That role no longer exists.'); // i18n-ignore: saved in the database
  if (targetRole.position >= botMember.roles.highest.position) {
    return fail(job, "That role is above Petto's highest role, move Petto's role above it and try again."); // i18n-ignore: saved in the database
  }

  await bulkRoleJobsDb.updateJob(job.id, { status: 'running' });
  // The job runs on a timer, outside of any server: the audit log and the notice use the server's language.
  const lang = await guildLanguage(guild.id);
  const auditReason = t(lang, 'moderation.bulkRole.audit', { id: job.id });

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    logger.error(`Bulk role job #${job.id}: failed to fetch members:`, err);
    return fail(job, "Couldn't load the member list, try again."); // i18n-ignore: saved in the database
  }

  const targets = members.filter((m) => matchesFilters(m, job));
  await bulkRoleJobsDb.updateJob(job.id, { total_members: targets.size });

  let processed = 0;
  let success = 0;
  let errors = 0;

  for (const member of targets.values()) {
    if (processed % CANCEL_CHECK_EVERY === 0) {
      const fresh = await bulkRoleJobsDb.getJob(job.id).catch(() => null);
      if (fresh?.status === 'cancelled') return;
    }

    try {
      const already = member.roles.cache.has(job.target_role_id);
      if (job.action === 'add' && !already) {
        await member.roles.add(job.target_role_id, auditReason);
        success++;
      } else if (job.action === 'remove' && already) {
        await member.roles.remove(job.target_role_id, auditReason);
        success++;
      }
    } catch (err) {
      errors++;
      logger.error(`Bulk role job #${job.id}: failed on member ${member.id}:`, err.message ?? err);
    }

    processed++;
    if (processed % PROGRESS_SAVE_EVERY === 0 || processed === targets.size) {
      await bulkRoleJobsDb.updateJob(job.id, { processed_members: processed, success_count: success, error_count: errors });
    }
  }

  await bulkRoleJobsDb.updateJob(job.id, {
    status: 'completed', processed_members: processed, success_count: success, error_count: errors, finished_at: new Date().toISOString(),
  });

  if (job.notify_channel_id) {
    const channel = await guild.channels.fetch(job.notify_channel_id).catch(() => null);
    if (channel?.isTextBased()) {
      const vars = { role: `<@&${job.target_role_id}>`, success, count: targets.size };
      const done = tn(lang, `moderation.bulkRole.done.${job.action === 'add' ? 'assigned' : 'removed'}`, targets.size, vars);
      await channel.send(done + (errors > 0 ? t(lang, 'moderation.bulkRole.failed', { count: errors }) : '.')).catch(() => {});
    }
  }
}

module.exports = { processBulkRoleJob, matchesFilters };
