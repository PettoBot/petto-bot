// A backup restore as a job that can be watched and stopped: one at a time in each server, with its progress, and a human check
// (a picture with letters, the one of the verification) that must be answered before it starts. The command and the dashboard use the same ones.
const crypto = require('crypto');
const config = require('../config');
const captcha = require('./verifyCaptcha');
const { restoreBackup, planRestore } = require('./backupRestore');
const logger = require('./logger');

const CHALLENGE_TTL_MS = 5 * 60_000;
const JOB_KEEP_MS = 30 * 60_000;
const MAX_WRONG = 5;
const LOCK_MS = 10 * 60_000;

const challenges = new Map(); // id -> { guildId, userId, kind, text, until }
const wrong = new Map(); // `${guildId}:${userId}` -> { count, until }
const jobs = new Map(); // guildId -> job

const normalise = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const attemptKey = (guildId, userId) => `${guildId}:${userId}`;

function prune(map, limit = 500) {
  const now = Date.now();
  for (const [key, entry] of map) if ((entry.until ?? 0) < now) map.delete(key);
  while (map.size > limit) map.delete(map.keys().next().value);
}

/**
 * A new human check for one person in one server: a picture with letters, or (when the letters cannot be drawn because the server has no
 * secret for them) the name of the server to type. `png` is only there for the picture.
 */
function createRestoreChallenge(guild, userId) {
  prune(challenges);
  const id = crypto.randomBytes(8).toString('hex');
  const until = Date.now() + CHALLENGE_TTL_MS;
  if (config.verifyTokenSecret) {
    const made = captcha.createChallenge(`restore:${guild.id}:${userId}:${id}`);
    challenges.set(id, { guildId: guild.id, userId, kind: 'letters', text: made.text, until });
    return { id, kind: 'letters', png: made.png, seconds: CHALLENGE_TTL_MS / 1000 };
  }
  challenges.set(id, { guildId: guild.id, userId, kind: 'name', text: guild.name, until });
  return { id, kind: 'name', name: guild.name, seconds: CHALLENGE_TTL_MS / 1000 };
}

/** `{ ok: true }`, or `{ ok: false, reason }` with `expired`, `wrong` or `locked`. A picture works once: a wrong answer needs a new one. */
function checkRestoreChallenge(id, guildId, userId, answer) {
  const key = attemptKey(guildId, userId);
  const lock = wrong.get(key);
  if (lock && lock.until > Date.now() && lock.count >= MAX_WRONG) return { ok: false, reason: 'locked' };
  const kept = challenges.get(String(id));
  if (!kept || kept.guildId !== guildId || kept.userId !== userId || kept.until < Date.now()) return { ok: false, reason: 'expired' };
  challenges.delete(String(id));
  const right = kept.kind === 'name' ? String(answer ?? '').trim() === kept.text : normalise(answer) === normalise(kept.text);
  if (right) { wrong.delete(key); return { ok: true }; }
  const count = (lock && lock.until > Date.now() ? lock.count : 0) + 1;
  wrong.set(key, { count, until: Date.now() + LOCK_MS });
  prune(wrong, 2_000);
  return { ok: false, reason: count >= MAX_WRONG ? 'locked' : 'wrong' };
}

/** What the person can see of a job: where it is, how far, and (when it ended) what it did. */
function describeJob(job) {
  if (!job) return null;
  const percent = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const result = job.result;
  return {
    id: job.id,
    guildId: job.guildId,
    userId: job.userId,
    number: job.number,
    mode: job.mode,
    parts: job.parts ?? null,
    status: job.status === 'running' && job.cancelRequested ? 'cancelling' : job.status,
    phase: job.phase,
    done: job.done,
    total: job.total,
    percent: job.status === 'done' ? 100 : percent,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    safetyNumber: job.safetyNumber,
    error: job.error,
    result: result ? {
      cancelled: Boolean(result.cancelled),
      deletionSkipped: result.deletionSkipped,
      roles: result.roles,
      channels: result.channels,
      emojis: result.emojis,
      stickers: result.stickers,
      automod: result.automod,
      deleted: result.deleted,
      errors: result.errors.slice(0, 5),
      errorCount: result.errors.length,
    } : null,
  };
}

function getJob(guildId) {
  const job = jobs.get(guildId);
  if (job && job.finishedAt && Date.now() - job.finishedAt > JOB_KEEP_MS) { jobs.delete(guildId); return null; }
  return job ?? null;
}

const isRunning = (guildId) => getJob(guildId)?.status === 'running';

/** Asks the running restore to stop. It finishes the step it is in, deletes nothing more and says what it did. */
function cancelJob(guildId) {
  const job = getJob(guildId);
  if (!job || job.status !== 'running') return false;
  job.cancelRequested = true;
  return true;
}

/**
 * Starts a restore and returns at once (the job goes on by itself; read it with `getJob`). `prepare` makes the safety backup and returns
 * its number: when it fails, nothing is restored. `finish(job)` runs after the end, to write the audit and tell the person.
 */
function startRestoreJob(guild, { userId, number, mode, snapshot, reason, prepare, finish, keepChannelIds = [], parts = null }) {
  if (isRunning(guild.id)) {
    const error = new Error('A restore is already running in this server.'); // i18n-ignore: internal error, callers show their own text
    error.code = 'restore_running';
    throw error;
  }
  const job = {
    id: crypto.randomBytes(6).toString('hex'),
    guildId: guild.id,
    userId,
    number,
    mode,
    status: 'running',
    phase: 'safety',
    done: 0,
    parts: planRestore(guild, snapshot, { mode, keepChannelIds, parts }).parts,
    total: planRestore(guild, snapshot, { mode, keepChannelIds, parts }).steps,
    startedAt: Date.now(),
    finishedAt: null,
    cancelRequested: false,
    safetyNumber: null,
    result: null,
    error: null,
  };
  jobs.set(guild.id, job);
  (async () => {
    try {
      job.safetyNumber = await prepare();
      if (job.cancelRequested) {
        const zero = () => ({ created: 0, updated: 0, skipped: 0, failed: 0 });
        job.result = { cancelled: true, deletionSkipped: null, roles: zero(), channels: zero(), emojis: zero(), deleted: { roles: 0, channels: 0 }, errors: [] };
        job.status = 'cancelled';
      } else {
        job.phase = 'roles';
        job.result = await restoreBackup(guild, snapshot, {
          mode,
          reason,
          keepChannelIds,
          parts,
          shouldStop: () => job.cancelRequested,
          onProgress: ({ phase, done, total }) => { job.phase = phase; job.done = done; job.total = total; },
        });
        job.status = job.result.cancelled ? 'cancelled' : 'done';
      }
    } catch (error) {
      job.status = 'failed';
      job.error = String(error?.message ?? error).slice(0, 300);
      logger.error(`Backup restore failed for guild ${guild.id}:`, error);
    }
    job.finishedAt = Date.now();
    try { await finish?.(job); } catch (error) { logger.warn(`Backup restore follow-up failed for guild ${guild.id}: ${error.message}`); }
  })();
  return job;
}

module.exports = { createRestoreChallenge, checkRestoreChallenge, startRestoreJob, cancelJob, getJob, isRunning, describeJob, MAX_WRONG, CHALLENGE_TTL_MS };
