// Checks that the shop score is gone and nothing automatic is left of it: the detector, its modules, its sweep and its message listener are not in the
// code, no path sends a notice to a server or makes Petto leave because of words, the manual tools stay (`!guildsend`, `!leaveguild`, the diagnostic sink),
// and nothing deletes the stored data by itself (schema.sql keeps the table, scripts/purge-compliance-data.js does it by hand). With
// PETTO_TEST_DATABASE_URL it also runs the purge tool against a test database.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL = process.env.PETTO_TEST_DATABASE_URL || 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
  ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

for (const file of ['src/utils/guildComplianceDetector.js', 'src/db/guildComplianceScores.js', 'src/db/guildComplianceSettings.js']) {
  assert.ok(!fs.existsSync(path.join(root, file)), `${file} is gone`);
}
const sources = [...walk('src'), 'index.js'].filter((file) => file.endsWith('.js'));
for (const file of sources) {
  const text = read(file);
  assert.ok(!/guildCompliance|attachGuildComplianceMonitor|scanGuildForCompliance|PETTO_GUILD_COMPLIANCE|guild_compliance|compliance_ignore/.test(text), `${file} does not use the shop score`);
  assert.ok(!/gops_ignore|\[shopdetector\]|\[discordcompliance\]/.test(text), `${file} has no ignore button or shop signal`);
}

// The notices a server can get by hand, and the alerts of the team: no `shop` kind, and nothing classifies a log line as a commerce signal.
const alerts = require('../src/utils/guildOpsAlerts');
assert.deepEqual(Object.keys(alerts.TEMPLATES).sort(), ['diagnostic', 'logs', 'maintenance', 'permissions', 'policy']);
for (const lang of ['en', 'es', 'pt-BR']) {
  const catalog = require(`../src/i18n/locales/${lang}/notices.js`);
  assert.ok(!Object.keys(catalog).some((key) => key.startsWith('notices.shop.')), `${lang}: no notice about shops`);
}

// The manual tools stay and cannot scan or score.
const guildsend = require('../src/commands/utility/guildsend');
assert.deepEqual(guildsend.data.toJSON().options.map((option) => option.name), ['guild_id', 'type', 'details']);
assert.ok(!/scan|score|unignore/.test(guildsend.data.toJSON().options[1].description), 'guildsend sends notices only');
assert.ok(fs.existsSync(path.join(root, 'src/commands/utility/leaveguild.js')), '!leaveguild stays');
assert.equal(typeof alerts.createGuildDiagnosticSink, 'function', 'the diagnostic sink stays');

// Only the diagnostics of logs and permissions are classified: a log line about shops, prices or policy is never a notice to a server.
const noticed = [];
const sink = alerts.createGuildDiagnosticSink({ guilds: { cache: { get: (id) => { noticed.push(id); return null; } }, fetch: async () => null }, channels: { cache: new Map() } });
(async () => {
  for (const text of ['[shopdetector] this server sells things', '[guildpolicy] explicit policy violation signal', 'shop store prices paypal nitro']) {
    await sink('warn', [text], 'now', { guildId: '123456789012345678' });
  }
  assert.deepEqual(noticed, [], 'a log line about shops or policy is not a notice');
  await sink('error', ['DiscordAPIError: Missing Permissions'], 'now', { guildId: '123456789012345678' });
  assert.deepEqual(noticed, ['123456789012345678'], 'the permission diagnostics still work');

  // schema.sql keeps the table and never drops or deletes it; the boot does not run the purge.
  const schema = read('src/db/schema.sql').replace(/--.*$/gm, '');
  assert.ok(/create table if not exists guild_compliance_scores/.test(schema), 'the table is left in schema.sql');
  assert.ok(!/(drop\s+table|delete\s+from|truncate)[^;]*guild_compliance_scores/i.test(schema), 'schema.sql does not delete the stored scores');
  assert.ok(!/drop\s+column[^;]*compliance_/i.test(schema), 'schema.sql does not drop the columns');
  assert.ok(!/purge-compliance-data/.test(read('index.js')), 'the boot does not run the purge');
  assert.ok(/no longer used/i.test(read('src/db/schema.sql')), 'schema.sql says the table is no longer used');

  const url = process.env.PETTO_TEST_DATABASE_URL;
  if (!url) {
    console.log('check-no-shop-score: ok (set PETTO_TEST_DATABASE_URL to a test database to run the purge tool too)');
    process.exit(0);
  }
  const { getPrimaryPool, closePools } = require('../src/db/postgres');
  const purge = require('./purge-compliance-data');
  const pool = getPrimaryPool();
  const ids = ['95000000000000001', '95000000000000002'];
  const clean = () => pool.query('delete from guilds where guild_id = any($1)', [ids]);
  await clean();
  await pool.query('insert into guilds (guild_id, compliance_ignored, compliance_ignored_by) values ($1, true, $3), ($2, false, null)', [ids[0], ids[1], '1']);
  await pool.query('insert into guild_compliance_scores (guild_id, score, actionable) values ($1, 9, true), ($2, 5, true)', ids);
  const before = await purge.survey(pool);
  assert.ok(before.scores >= 2 && before.settings >= 1);
  const dry = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'purge-compliance-data.js')], { env: { ...process.env, DISCLOUD_DATABASE_URL: url }, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run: nothing was deleted/);
  assert.deepEqual(await purge.survey(pool), before, 'without --yes nothing is deleted');
  const done = await purge.purge(pool);
  assert.ok(done.scores >= 2 && done.settings >= 1);
  assert.deepEqual(await purge.survey(pool), { scores: 0, settings: 0 });
  assert.equal(await pool.query('select to_regclass($1) is not null as found', ['guild_compliance_scores']).then((r) => r.rows[0].found), true, 'the table is not dropped');
  await clean();
  await closePools();
  console.log('check-no-shop-score: ok');
})().catch((error) => { console.error(error); process.exit(1); });
