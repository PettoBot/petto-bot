// The routes the dashboard uses for commands in code: the pieces for its editor (the functions and the templates), a check of
// the code while it is written, a test run that changes nothing, and saving. Each one is for someone who manages the server,
// and saving and testing also need the same permission as writing code in Discord.
const { rateLimit } = require('express-rate-limit');
const { run, check, PettoCodeError, functionNames, DEFAULT_LIMITS, MAX_SOURCE_LENGTH } = require('../scripting');
const { functions } = require('../scripting/functions');
const { TEMPLATES } = require('../scripting/templates');
const { TRIGGER_TYPES } = require('../utils/codeTriggers');
const codeCommands = require('../utils/codeCommands');
const admin = require('../utils/codeCommandAdmin');
const logger = require('../utils/logger');

const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

/** The data a test run reads: the member who is testing, the server, and a channel to stand for the one it would run in. */
function sampleData(guild, member, args) {
  const user = member.user;
  const channel = guild.systemChannel ?? guild.channels.cache.find((entry) => entry.isTextBased?.()) ?? { id: '0', name: 'general' };
  return codeCommands.buildData({
    id: '0', content: '', url: null, embeds: [], guild, channel, member, author: user,
  }, 'test', args, '!');
}

function registerCodeRoutes(app, { authorize }) {
  const route = (handler) => async (req, res) => {
    const access = await authorize(req, res);
    if (!access) return;
    try { await handler(req, res, access); } catch (error) {
      logger.error({ guildId: req.params.guildId, action: 'code-route' }, `Code command request failed: ${error.message}`);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'code_unavailable' });
    }
  };
  const needWrite = (res) => {
    if (codeCommands.canWriteCode()) return true;
    res.status(403).json({ ok: false, error: 'turned_off', message: 'Commands in code are turned off for now.' });
    return false;
  };

  app.get('/api/dashboard/guild/:guildId/code/meta', limiter, route(async (req, res) => {
    const allowed = await admin.commandLimit(req.params.guildId);
    res.json({
      ok: true,
      canWrite: codeCommands.canWriteCode(),
      functions: [...functions.entries()].map(([name, entry]) => ({ name, min: entry.min, max: entry.max })).sort((a, b) => a.name.localeCompare(b.name)),
      templates: TEMPLATES.map(({ id, name, description, suggestedName, code }) => ({ id, name, description, suggestedName, code })),
      triggerTypes: TRIGGER_TYPES,
      limits: { source: MAX_SOURCE_LENGTH, steps: DEFAULT_LIMITS.maxSteps, commands: allowed.limit, premium: allowed.premium, storeCalls: DEFAULT_LIMITS.maxStoreCalls },
    });
  }));

  // The mistake in the code, for the editor to show while someone writes, and hints: names that are most likely mistakes
  // (a function that does not exist, `.User.Usrname`), as sentences. Code with a mistake or too long has no hints.
  app.post('/api/dashboard/guild/:guildId/code/check', limiter, route(async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (code.length > MAX_SOURCE_LENGTH + 1000) { res.json({ ok: true, problem: { kind: 'limit', message: `The code is too long (more than ${MAX_SOURCE_LENGTH} characters)`, line: null, column: null }, hints: [] }); return; }
    const problem = code.length > MAX_SOURCE_LENGTH ? { kind: 'limit', message: `The code is too long (${code.length} of ${MAX_SOURCE_LENGTH} characters)`, line: null, column: null } : check(code);
    res.json({ ok: true, problem, hints: problem ? [] : admin.codeHints(code) });
  }));

  // Runs the code as the person who is testing, with memory-only storage: nothing is sent, saved or changed.
  app.post('/api/dashboard/guild/:guildId/code/test', limiter, route(async (req, res, { guild, member, userId }) => {
    if (!needWrite(res)) return;
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const args = typeof req.body?.args === 'string' ? req.body.args.slice(0, 500) : '';
    const trigger = ['button', 'select'].includes(req.body?.trigger) ? req.body.trigger : 'command';
    const problem = admin.codeProblem(code);
    if (problem) { res.json({ ok: true, error: { kind: 'syntax', message: problem }, hints: [] }); return; }
    const hints = admin.codeHints(code);
    const data = sampleData(guild, member, args);
    if (trigger !== 'command') {
      data.Trigger = trigger;
      data.Button = { ID: String(req.body?.handler ?? '').slice(0, 20), Data: String(req.body?.data ?? '').slice(0, 20) };
      data.Values = trigger === 'select' ? [String(req.body?.value ?? '').slice(0, 100)].filter(Boolean) : [];
    }
    try {
      const result = await run(code, data, { store: codeCommands.memoryStore(), lookup: codeCommands.lookupFor(guild) });
      // `actions` says each effect as a sentence; `effects` are the effects themselves (what run gives), for a preview that
      // draws the messages like Discord does.
      res.json({ ok: true, output: result.output, actions: result.effects.map(admin.describeEffect), effects: result.effects, hints, steps: result.steps, millis: result.millis });
    } catch (error) {
      if (error instanceof PettoCodeError) { res.json({ ok: true, error: { kind: error.kind, message: error.detail, line: error.line, column: error.column }, hints }); return; }
      throw error;
    }
  }));

  app.post('/api/dashboard/guild/:guildId/code/save', limiter, route(async (req, res, { guild, userId }) => {
    if (!needWrite(res)) return;
    const name = String(req.body?.name ?? '').toLowerCase().trim().replace(/\s+/g, '');
    const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\r\n/g, '\n') : '';
    const saved = await admin.saveCodeCommand({ guild, client: guild.client, userId, name, code });
    res.status(saved.ok ? 200 : 400).json(saved);
  }));

  app.post('/api/dashboard/guild/:guildId/code/trigger', limiter, route(async (req, res, { guild, userId }) => {
    if (!needWrite(res)) return;
    const name = String(req.body?.name ?? '').toLowerCase().trim();
    const changed = await admin.setCommandTrigger({ guild, client: guild.client, name, type: String(req.body?.type ?? ''), text: typeof req.body?.text === 'string' ? req.body.text : null });
    res.status(changed.ok ? 200 : 400).json(changed);
  }));
}

module.exports = { registerCodeRoutes, functionNames };
