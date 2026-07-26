const { PermissionFlagsBits } = require('discord.js');
const bulkRoleJobsDb = require('../db/bulkRoleJobs');
const logger = require('./logger');

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

async function fail(job, message) {
  await bulkRoleJobsDb.updateJob(job.id, { status: 'failed', error_message: message, finished_at: new Date().toISOString() });
}

/** Runs one bulk-role job to completion (or until cancelled), applied member-by-member so Discord's own per-route rate limiting paces it naturally, no manual throttling needed. */
async function processBulkRoleJob(client, job) {
  const guild = await client.guilds.fetch(job.guild_id).catch(() => null);
  if (!guild) return fail(job, "Petto isn't in that server anymore.");

  const botMember = await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return fail(job, 'Petto is missing the Manage Roles permission.');

  const targetRole = await guild.roles.fetch(job.target_role_id).catch(() => null);
  if (!targetRole) return fail(job, 'That role no longer exists.');
  if (targetRole.position >= botMember.roles.highest.position) {
    return fail(job, "That role is above Petto's highest role, move Petto's role above it and try again.");
  }

  await bulkRoleJobsDb.updateJob(job.id, { status: 'running' });

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    logger.error(`Bulk role job #${job.id}: failed to fetch members:`, err);
    return fail(job, "Couldn't load the member list, try again.");
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
        await member.roles.add(job.target_role_id, `Bulk role job #${job.id}`);
        success++;
      } else if (job.action === 'remove' && already) {
        await member.roles.remove(job.target_role_id, `Bulk role job #${job.id}`);
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
      const verb = job.action === 'add' ? 'assigned' : 'removed';
      await channel.send(
        `Bulk role job finished: **${verb}** <@&${job.target_role_id}> for **${success}** of **${targets.size}** matched member${targets.size === 1 ? '' : 's'}` +
        (errors > 0 ? ` (${errors} failed, usually role-hierarchy or a member who left mid-run).` : '.'),
      ).catch(() => {});
    }
  }
}

module.exports = { processBulkRoleJob, matchesFilters };
