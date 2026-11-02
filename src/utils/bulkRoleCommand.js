// The mass role commands (`/role all|humans|has|bots|bots-remove`, `/role join apply`, `/role job`) all start the same kind of job the dashboard
// starts (db/bulkRoleJobs.js, utils/bulkRoleEngine.js): one job at a time for a server, saved in the database so a restart does not lose it, with
// a card in the channel that follows it and can be paused or cancelled from here or from the dashboard.
const { MessageFlags } = require('discord.js');
const bulkRoleJobsDb = require('../db/bulkRoleJobs');
const { ensureGuild } = require('../db/guilds');
const { runJob } = require('../jobs/bulkRoleJob');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const { buildCardText, checkTargetRole, dangerousBits, parseJoinedInput } = require('./bulkRolePlan');
const { t, languageOf } = require('../i18n');

const RECENT_JOBS = 5;

/** The text of a refusal of `checkTargetRole`, in the language of the person. */
function refusalText(lang, code) {
  return t(lang, `moderation.bulkRole.card.error.${code}`, { text: '' });
}

/**
 * Starts a job for a mass role command and answers with the card that follows it. The caller has already checked who may run it (Administrator),
 * and that the role is one the moderator may handle (`filterAssignableRoles`). `options`: `role`, `action` (add|remove), `memberType`,
 * `filterRole` + `exclude`, `joinedAfter` / `joinedBefore` (what was typed), `minRoles` / `maxRoles`, `skipPending`, `preview`, `reason`.
 */
async function startMassJob(interaction, options) {
  const lang = await languageOf(interaction);
  const { guild } = interaction;
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  const refusal = checkTargetRole({ guildId: guild.id, role: options.role, botMember: guild.members.me });
  if (refusal) return reply(refusalText(lang, refusal));

  const joinedAfter = parseJoinedInput(options.joinedAfter);
  const joinedBefore = parseJoinedInput(options.joinedBefore);
  if (joinedAfter === undefined || joinedBefore === undefined) return reply(t(lang, 'moderation.bulkRole.badDate'));
  if (joinedAfter && joinedBefore && joinedAfter > joinedBefore) return reply(t(lang, 'moderation.bulkRole.dateOrder'));
  const { minRoles = null, maxRoles = null } = options;
  if (minRoles !== null && maxRoles !== null && minRoles > maxRoles) return reply(t(lang, 'moderation.bulkRole.rolesOrder'));

  if (await bulkRoleJobsDb.getActiveJob(guild.id)) return reply(t(lang, 'moderation.role.mass.alreadyRunning'));

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(guild.id);
  const job = await bulkRoleJobsDb.createJob({
    guild_id: guild.id,
    action: options.action,
    target_role_id: options.role.id,
    member_type: options.memberType ?? 'all',
    filter_role_ids: options.filterRole ? [options.filterRole.id] : [],
    filter_mode: 'any',
    filter_exclude: Boolean(options.exclude),
    joined_after: joinedAfter,
    joined_before: joinedBefore,
    min_roles: minRoles,
    max_roles: maxRoles,
    skip_pending: Boolean(options.skipPending),
    dry_run: Boolean(options.preview),
    reason: options.reason ? String(options.reason).trim().slice(0, 300) : null,
    started_by: interaction.user.id,
    source: 'discord',
    notify_channel_id: null,
  });

  const dangerous = dangerousBits(options.role);
  const { text, color } = buildCardText(lang, job, { dangerous });
  const message = await interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  if (message?.id) await bulkRoleJobsDb.updateJob(job.id, { progress_channel_id: message.channelId ?? interaction.channelId, progress_message_id: message.id });
  runJob(interaction.client, { ...job, progress_channel_id: message?.channelId ?? interaction.channelId, progress_message_id: message?.id ?? null });
  return job;
}

/** One line for the history of jobs: number, what it did, to which role, how it ended and when. */
function historyLine(lang, job) {
  const when = Math.floor(new Date(job.finished_at ?? job.created_at).getTime() / 1000);
  const kind = t(lang, `moderation.bulkRole.history.${job.dry_run ? 'preview.' : ''}${job.action === 'add' ? 'add' : 'remove'}`);
  return t(lang, 'moderation.bulkRole.history.line', {
    id: job.id, kind, role: `<@&${job.target_role_id}>`, status: t(lang, `moderation.bulkRole.card.state.${job.status}`), changed: job.success_count ?? 0, failed: job.error_count ?? 0, time: `<t:${when}:R>`,
  });
}

/** `/role job status`: the card of the running (or latest) job and the last few. */
async function showJob(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const jobs = await bulkRoleJobsDb.listRecent(interaction.guild.id, RECENT_JOBS);
  if (!jobs.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.role.job.none'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const role = interaction.guild.roles.cache.get(jobs[0].target_role_id);
  const { text, color } = buildCardText(lang, jobs[0], { dangerous: jobs[0].action === 'add' ? dangerousBits(role) : 0n });
  const history = jobs.slice(1).map((job) => historyLine(lang, job));
  const body = history.length ? `${text}\n\n${t(lang, 'moderation.bulkRole.history.title')}\n${history.join('\n')}` : text;
  await interaction.editReply({ components: [textCard(body.slice(0, 3900), color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

/** `pause`, `resume` or `cancel` the job of the server that is pending or running. Answers in private. */
async function controlJob(interaction, action) {
  const lang = await languageOf(interaction);
  const active = await bulkRoleJobsDb.getActiveJob(interaction.guild.id);
  if (!active) {
    await interaction.reply({ content: t(lang, 'moderation.role.mass.notRunning'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'cancel') await bulkRoleJobsDb.cancelJob(active.id, interaction.guild.id);
  else await bulkRoleJobsDb.setPaused(active.id, interaction.guild.id, action === 'pause');
  await interaction.reply({ content: t(lang, `moderation.role.job.${action}`, { emoji: EMOJI.APPROVE, id: active.id }), flags: MessageFlags.Ephemeral });
}

module.exports = { startMassJob, showJob, controlJob, historyLine };
