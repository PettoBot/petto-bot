// The verification buttons of the dashboard (set it up, post the panel, switch it on) as jobs: on a big server setting it up edits every
// channel, which takes longer than the website waits for an answer. The route starts the job, waits a moment (a quick one answers right
// away) and otherwise says it is running; the page then asks how far it is. One job per server at a time, kept in memory (like the
// restores of backupJobs.js): a second press while one runs gets the one that runs.
const crypto = require('crypto');
const { setupEverything, sendPanelNow, setEnabled } = require('./verifyProvision');
const logger = require('./logger');
const { t } = require('../i18n');

const JOB_KEEP_MS = 15 * 60_000;
const RUNNERS = {
  setup: (guild, options) => setupEverything(guild, options),
  panel: (guild, options) => sendPanelNow(guild, options),
  enable: (guild, options) => setEnabled(guild, true, options),
};
const JOB_ACTIONS = new Set(Object.keys(RUNNERS));

const jobs = new Map(); // guildId -> job

function getJob(guildId) {
  const job = jobs.get(guildId);
  if (job && job.finishedAt && Date.now() - job.finishedAt > JOB_KEEP_MS) { jobs.delete(guildId); return null; }
  return job ?? null;
}

const isRunning = (guildId) => getJob(guildId)?.status === 'running';

/** The step a job is in, in words (`lang`): "Channels 34/120", "Making the roles…", "Posting the panel…". */
function progressText(job, lang) {
  if (!job) return '';
  if (job.phase === 'channels') return t(lang, 'verify.job.channels', { done: job.done, total: job.total });
  if (job.phase === 'roles') return t(lang, 'verify.job.roles');
  if (job.phase === 'panel') return t(lang, 'verify.job.panel');
  return t(lang, 'verify.job.starting');
}

/** What the dashboard sees of a job. `message` is the answer once it ended (in the language of the server, as the direct answers are). */
function describeJob(job, lang = 'en') {
  if (!job) return null;
  const percent = job.status !== 'running' ? 100 : job.phase === 'channels' && job.total ? Math.min(99, Math.round((job.done / job.total) * 100)) : 0;
  return {
    id: job.id,
    action: job.action,
    status: job.status,
    phase: job.phase,
    done: job.done,
    total: job.total,
    percent,
    progress: progressText(job, lang),
    ok: job.ok,
    message: job.message,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

/**
 * Starts `action` (setup, panel, enable) for `guild` and returns the job at once; it goes on by itself. When one is already running in that
 * server, that one is returned with `already: true` and nothing new starts. `onProgress` and `onEnd(job)` are for a caller that follows it
 * (the command edits its answer).
 */
function startVerifyJob(guild, action, { userId = null, onProgress = null, onEnd = null } = {}) {
  if (!JOB_ACTIONS.has(action)) throw new Error(`Unknown verification job: ${action}`); // i18n-ignore: internal error
  const current = getJob(guild.id);
  if (current?.status === 'running') return { job: current, already: true };
  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    guildId: guild.id,
    action,
    userId,
    status: 'running',
    phase: 'starting',
    done: 0,
    total: 0,
    ok: null,
    message: null,
    startedAt: Date.now(),
    finishedAt: null,
    ended: null,
  };
  jobs.set(guild.id, job);
  const step = (progress) => {
    if (progress?.phase) job.phase = progress.phase;
    job.done = Number(progress?.done) || 0;
    job.total = Number(progress?.total) || 0;
    try { onProgress?.(job); } catch { /* following it never stops it */ }
  };
  job.ended = (async () => {
    try {
      const result = await RUNNERS[action](guild, { onProgress: step });
      job.ok = Boolean(result?.ok);
      job.message = typeof result?.message === 'string' ? result.message : null;
      job.status = job.ok ? 'done' : 'failed';
    } catch (error) {
      job.ok = false;
      job.message = String(error?.message ?? error).slice(0, 300);
      job.status = 'failed';
      logger.error(`Verification ${action} failed for guild ${guild.id}:`, error);
    }
    job.finishedAt = Date.now();
    try { await onEnd?.(job); } catch (error) { logger.warn(`Verification ${action} follow-up failed for guild ${guild.id}: ${error.message}`); }
    return job;
  })();
  return { job, already: false };
}

/** Waits for `job` to end, at most `ms`. True when it ended. */
async function waitForJob(job, ms) {
  if (!job || job.status !== 'running') return true;
  let timer;
  const ended = await Promise.race([job.ended.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })]);
  clearTimeout(timer);
  return ended;
}

module.exports = { startVerifyJob, waitForJob, getJob, isRunning, describeJob, progressText, JOB_ACTIONS };
