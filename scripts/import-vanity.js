// Copies the data of the old Vanity bot into Petto's database: rules, the ledger of roles (who got a role from the bot, so
// nothing the bot gave is mistaken for a role someone added by hand), the audit trail, the thank-you messages, the log
// settings and the saved embeds (they become saved embeds of Petto, usable in Embeds). It never deletes and can be run again.
//
// The saved embeds come over as Components V2 designs (the old flat embed becomes a card with a header, sections and a footer;
// the messages the old bot made by itself get Petto's own thank-you and log designs). `--upgrade-embeds` does that for the
// ones an earlier run brought over as classic embeds.
//
//   VANITY_DATABASE_URL=postgres://... node scripts/import-vanity.js [--dry-run] [--reset-log-embeds] [--upgrade-embeds]
//
// The target is Petto's own database (the same one the bot uses). Nothing is printed except counts.
const { Pool } = require('pg');
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const { toPettoTemplate, freeName } = require('../src/utils/identity/importVanity');
const { toV2 } = require('../src/utils/identity/v2Designs');

const dryRun = process.argv.includes('--dry-run');
const resetLogEmbeds = process.argv.includes('--reset-log-embeds');
const upgradeEmbeds = process.argv.includes('--upgrade-embeds');
const sourceUrl = process.env.VANITY_DATABASE_URL;
if (!sourceUrl) {
  console.error('Set VANITY_DATABASE_URL to the connection string of the old Vanity bot database.');
  process.exit(1);
}

function sourcePool() {
  let connectionString = sourceUrl;
  let ssl = false;
  try {
    const url = new URL(sourceUrl);
    const mode = url.searchParams.get('sslmode');
    if (mode && mode !== 'disable') ssl = { rejectUnauthorized: false };
    url.searchParams.delete('sslmode');
    connectionString = url.toString();
  } catch { /* pg reports a malformed string itself */ }
  return new Pool({ connectionString, ssl, max: 2 });
}

const BATCH = 500;

async function copy(source, target, label, select, insert, map = (row) => row) {
  const { rows } = await source.query(select);
  let written = 0;
  for (let index = 0; index < rows.length; index += BATCH) {
    for (const row of rows.slice(index, index + BATCH)) {
      const values = map(row);
      if (!values) continue;
      const result = await target.query(insert, values);
      written += result.rowCount;
    }
  }
  console.log(`${label}: ${rows.length} read, ${written} new`);
  return rows;
}

(async () => {
  const source = sourcePool();
  const target = await getPrimaryPool().connect();
  try {
    await target.query('begin');

    const guilds = await source.query('select guild_id from guild_configs');
    for (const { guild_id: guildId } of guilds.rows) await target.query('insert into guilds (guild_id) values ($1) on conflict do nothing', [guildId]);
    console.log(`servers: ${guilds.rows.length}`);

    await copy(source, target, 'vanity rules',
      'select id, guild_id, name, word, source, comparison, role_id, action, enabled, priority, normalization, created_by, created_at, updated_at, deleted_at from vanity_rules',
      'insert into vanity_rules (id, guild_id, name, word, source, comparison, role_id, action, enabled, priority, normalization, created_by, created_at, updated_at, deleted_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict do nothing',
      (r) => [r.id, r.guild_id, r.name, r.word, r.source, r.comparison, r.role_id, r.action, r.enabled, r.priority, JSON.stringify(r.normalization), r.created_by, r.created_at, r.updated_at, r.deleted_at]);

    await copy(source, target, 'server tag rules',
      'select id, guild_id, name, condition, value, role_id, action, enabled, priority, created_by, created_at, updated_at, deleted_at from guildtag_rules',
      'insert into guildtag_rules (id, guild_id, name, condition, value, role_id, action, enabled, priority, created_by, created_at, updated_at, deleted_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing',
      (r) => [r.id, r.guild_id, r.name, r.condition, r.value, r.role_id, r.action, r.enabled, r.priority, r.created_by, r.created_at, r.updated_at, r.deleted_at]);

    await copy(source, target, 'role grants',
      'select guild_id, user_id, role_id, rule_id, source_type, action, matched, bot_added_role, last_evaluated_at, created_at, updated_at from identity_role_grants',
      'insert into identity_role_grants (guild_id, user_id, role_id, rule_id, source_type, action, matched, bot_added_role, last_evaluated_at, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing',
      (r) => [r.guild_id, r.user_id, r.role_id, r.rule_id, r.source_type, r.action, r.matched, r.bot_added_role, r.last_evaluated_at, r.created_at, r.updated_at]);

    await copy(source, target, 'role state',
      'select guild_id, user_id, role_id, bot_added_role, manual_marked, last_known_present, created_at, updated_at from identity_role_state',
      'insert into identity_role_state (guild_id, user_id, role_id, bot_added_role, manual_marked, last_known_present, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing',
      (r) => [r.guild_id, r.user_id, r.role_id, r.bot_added_role, r.manual_marked, r.last_known_present, r.created_at, r.updated_at]);

    await copy(source, target, 'audit trail',
      'select event_type, dedupe_key, guild_id, actor_id, user_id, role_id, rule_id, source_type, action, result, error, metadata, created_at from identity_audit_events order by id',
      'insert into identity_audit_events (event_type, dedupe_key, guild_id, actor_id, user_id, role_id, rule_id, source_type, action, result, error, metadata, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing',
      (r) => [r.event_type, r.dedupe_key, r.guild_id, r.actor_id, r.user_id, r.role_id, r.rule_id, r.source_type, r.action, r.result, r.error, JSON.stringify(r.metadata ?? {}), r.created_at]);

    // Saved embeds: they become Petto's saved embeds. A name that Petto already has for that server is not overwritten.
    const templates = await source.query('select id, guild_id, name, payload from embed_templates where deleted_at is null');
    const nameOf = new Map();
    const takenRows = await target.query('select guild_id, name, data->>\'_vanity_id\' as vanity_id from embed_templates');
    const taken = new Map();
    const already = new Map();
    for (const row of takenRows.rows) {
      if (!taken.has(row.guild_id)) taken.set(row.guild_id, new Set());
      taken.get(row.guild_id).add(row.name);
      if (row.vanity_id) already.set(`${row.guild_id}:${row.vanity_id}`, row.name);
    }
    let embedsWritten = 0;
    let upgraded = 0;
    for (const template of templates.rows) {
      // An embed that an earlier run brought over keeps its name, so running the import again does not make copies.
      const before = already.get(`${template.guild_id}:${template.id}`);
      if (before) {
        nameOf.set(template.id, before);
        if (upgradeEmbeds) {
          const result = await target.query(
            "update embed_templates set data = $3, updated_at = now() where guild_id = $1 and name = $2 and data ->> '_vanity_id' = $4 and not (data ? 'v2')",
            [template.guild_id, before, JSON.stringify({ v2: toV2(template.name, toPettoTemplate(template.payload)), _vanity_id: template.id }), template.id]);
          upgraded += result.rowCount;
        }
        continue;
      }
      const names = taken.get(template.guild_id) ?? new Set();
      taken.set(template.guild_id, names);
      const name = freeName(template.name, names);
      names.add(name);
      nameOf.set(template.id, name);
      await target.query('insert into guilds (guild_id) values ($1) on conflict do nothing', [template.guild_id]);
      const result = await target.query(
        'insert into embed_templates (guild_id, name, data, updated_at) values ($1,$2,$3,now()) on conflict (guild_id, name) do nothing',
        [template.guild_id, name, JSON.stringify({ v2: toV2(template.name, toPettoTemplate(template.payload)), _vanity_id: template.id })]);
      embedsWritten += result.rowCount;
    }
    console.log(`embeds: ${templates.rows.length} read, ${embedsWritten} new (as V2 saved embeds of Petto)${upgradeEmbeds ? `, ${upgraded} upgraded to V2` : ''}`);

    await copy(source, target, 'thank-you messages',
      'select guild_id, source_type, channel_id, embed_id, ping from notification_configs',
      'insert into identity_notifications (guild_id, source_type, channel_id, embed_name, ping, updated_at) values ($1,$2,$3,$4,$5,now()) on conflict do nothing',
      (r) => [r.guild_id, r.source_type, r.channel_id, r.embed_id ? (nameOf.get(r.embed_id) ?? '') : '', r.ping]);

    // The old bot kept a saved embed per log event but never used it (its log entries always had the same look), so they are not
    // brought over as a choice: the log keeps the entry the old bot sent. `--reset-log-embeds` takes them off for a server where an
    // earlier import did bring them.
    const bindings = await source.query('select guild_id, event_key, template_id from log_embed_bindings');
    if (resetLogEmbeds) {
      let cleared = 0;
      for (const binding of bindings.rows) {
        const name = nameOf.get(binding.template_id);
        if (!name) continue;
        const result = await target.query(
          "update identity_logs set embeds = embeds - $3, updated_at = now() where guild_id = $1 and embeds ->> $3 = $2",
          [binding.guild_id, name, binding.event_key]);
        cleared += result.rowCount;
      }
      console.log(`log embeds taken off: ${cleared}`);
    }
    await copy(source, target, 'log settings',
      'select guild_id, channel_id, events from log_configs',
      'insert into identity_logs (guild_id, channel_id, events, embeds, updated_at) values ($1,$2,$3,$4,now()) on conflict do nothing',
      (r) => [r.guild_id, r.channel_id, JSON.stringify(r.events ?? {}), '{}']);

    if (dryRun) { await target.query('rollback'); console.log('Dry run: nothing was written.'); } else { await target.query('commit'); console.log('Done.'); }
  } catch (error) {
    await target.query('rollback').catch(() => {});
    console.error(`The import failed and nothing was written: ${error.message}`);
    process.exitCode = 1;
  } finally {
    target.release();
    await source.end();
    await closePools();
  }
})();
