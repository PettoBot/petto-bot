// Storage for Vanity and Server Tag rules and the ledger of the roles the bot manages with them. Raw SQL on the main pool:
// the ledger needs transactions and `for update`, which the table helpers do not offer.
const crypto = require('node:crypto');
const { getPrimaryPool } = require('./postgres');

const pool = () => getPrimaryPool();
const newId = () => crypto.randomBytes(16).toString('hex');

const TABLE = { vanity: 'vanity_rules', guildtag: 'guildtag_rules' };

function mapVanity(row) {
  return { id: row.id, guild_id: row.guild_id, name: row.name, word: row.word, source: row.source, comparison: row.comparison, role_id: row.role_id, action: row.action, enabled: row.enabled, priority: row.priority, normalization: row.normalization ?? undefined, created_by: row.created_by };
}
const mapGuildTag = (row) => ({ id: row.id, guild_id: row.guild_id, name: row.name, condition: row.condition, value: row.value, role_id: row.role_id, action: row.action, enabled: row.enabled, priority: row.priority, created_by: row.created_by });

/** The rules of a server. `all` also gives the turned-off ones; deleted rules are never given. */
async function listVanityRules(guildId, { all = false } = {}) {
  const { rows } = await pool().query(`select * from vanity_rules where guild_id = $1 and deleted_at is null ${all ? '' : 'and enabled = true'} order by priority desc, name asc`, [String(guildId)]);
  return rows.map(mapVanity);
}
async function listGuildTagRules(guildId, { all = false } = {}) {
  const { rows } = await pool().query(`select * from guildtag_rules where guild_id = $1 and deleted_at is null ${all ? '' : 'and enabled = true'} order by priority desc, name asc`, [String(guildId)]);
  return rows.map(mapGuildTag);
}

/** True when the server has any rule, or any role the bot still manages: the events skip every other server cheaply. */
async function hasActiveRules(guildId) {
  const { rows } = await pool().query(`
    select exists (
      select 1 from vanity_rules where guild_id = $1 and enabled = true and deleted_at is null
      union all select 1 from guildtag_rules where guild_id = $1 and enabled = true and deleted_at is null
      union all select 1 from identity_role_state where guild_id = $1 and bot_added_role = true
      union all select 1 from identity_role_grants where guild_id = $1 and matched = true
    ) as found`, [String(guildId)]);
  return rows[0].found;
}

/** The ids of the roles that rules of this server add or remove, for the features that must not fight with them (sticky roles). */
async function managedRoleIds(guildId) {
  const { rows } = await pool().query(`
    select role_id from vanity_rules where guild_id = $1 and enabled = true and deleted_at is null
    union select role_id from guildtag_rules where guild_id = $1 and enabled = true and deleted_at is null`, [String(guildId)]);
  return rows.map((row) => row.role_id);
}

async function createRule(source, guildId, rule) {
  const id = newId();
  if (source === 'vanity') {
    await pool().query(
      `insert into vanity_rules (id, guild_id, name, word, source, comparison, role_id, action, enabled, priority, normalization, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, String(guildId), rule.name, rule.word, rule.source, rule.comparison, rule.role_id, rule.action, rule.enabled !== false, rule.priority ?? 0, JSON.stringify(rule.normalization ?? { case_fold: true, trim_space: true, collapse_space: true }), rule.created_by ?? ''],
    );
  } else {
    await pool().query(
      `insert into guildtag_rules (id, guild_id, name, condition, value, role_id, action, enabled, priority, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, String(guildId), rule.name, rule.condition, rule.value ?? '', rule.role_id, rule.action, rule.enabled !== false, rule.priority ?? 0, rule.created_by ?? ''],
    );
  }
  return id;
}

/** A rule changed: the grants it justified stop counting, so the next evaluation of each member starts from the new rule. */
async function updateRule(source, guildId, name, fields) {
  const client = await pool().connect();
  try {
    await client.query('begin');
    const columns = Object.keys(fields);
    const set = columns.map((column, index) => `${column} = $${index + 3}`).join(', ');
    const { rows } = await client.query(
      `update ${TABLE[source]} set ${set}${set ? ',' : ''} updated_at = now() where guild_id = $1 and name = $2 and deleted_at is null returning id`,
      [String(guildId), name, ...columns.map((column) => (column === 'normalization' ? JSON.stringify(fields[column]) : fields[column]))],
    );
    if (!rows.length) { await client.query('rollback'); return false; }
    await client.query(
      "update identity_role_grants set matched = false, last_evaluated_at = now(), updated_at = now() where guild_id = $1 and rule_id = $2 and source_type = $3 and matched = true",
      [String(guildId), rows[0].id, source],
    );
    await client.query('commit');
    return true;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Deleting keeps the row (for the audit trail) but turns it off, and its grants stop counting. */
async function deleteRule(source, guildId, name) {
  const client = await pool().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `update ${TABLE[source]} set enabled = false, deleted_at = now(), updated_at = now() where guild_id = $1 and name = $2 and deleted_at is null returning id`,
      [String(guildId), name],
    );
    if (!rows.length) { await client.query('rollback'); return false; }
    await client.query(
      "update identity_role_grants set matched = false, last_evaluated_at = now(), updated_at = now() where guild_id = $1 and rule_id = $2 and source_type = $3 and matched = true",
      [String(guildId), rows[0].id, source],
    );
    await client.query('commit');
    return true;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---- The ledger

/** Grants of this member from `source` that no active rule justifies anymore stop counting. `scopes` is `[{ ruleId, roleId, action }]`. */
async function invalidateStaleGrants(guildId, userId, source, scopes) {
  const args = [String(guildId), String(userId), source];
  let sql = 'update identity_role_grants set matched = false, last_evaluated_at = now(), updated_at = now() where guild_id = $1 and user_id = $2 and source_type = $3 and matched = true';
  if (scopes.length) {
    const clauses = scopes.map((scope) => {
      const base = args.length + 1;
      args.push(scope.ruleId, scope.roleId, scope.action);
      return `(rule_id = $${base} and role_id = $${base + 1} and action = $${base + 2})`;
    });
    sql += ` and not (${clauses.join(' or ')})`;
  }
  await pool().query(sql, args);
}

async function managedRolesOfMember(guildId, userId) {
  const { rows } = await pool().query(`
    select role_id from identity_role_state where guild_id = $1 and user_id = $2 and bot_added_role = true
    union
    select role_id from identity_role_grants where guild_id = $1 and user_id = $2 and (matched = true or bot_added_role = true)`, [String(guildId), String(userId)]);
  return rows.map((row) => row.role_id).filter(Boolean);
}

/** Records what a rule says about a member right now, and whether it matched before (to tell a new match from a repeated one). */
async function recordGrant(grant, audit) {
  const client = await pool().connect();
  try {
    await client.query('begin');
    const previous = await client.query(
      'select matched from identity_role_grants where guild_id = $1 and user_id = $2 and role_id = $3 and rule_id = $4 for update',
      [grant.guildId, grant.userId, grant.roleId, grant.ruleId],
    );
    const transition = { hadPrevious: previous.rows.length > 0, previousMatched: previous.rows[0]?.matched ?? false };
    await client.query(`
      insert into identity_role_grants (guild_id, user_id, role_id, rule_id, source_type, action, matched, bot_added_role, last_evaluated_at, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,false,now(),now(),now())
      on conflict (guild_id, user_id, role_id, rule_id) do update set
        source_type = excluded.source_type, action = excluded.action, matched = excluded.matched, last_evaluated_at = now(), updated_at = now()`,
      [grant.guildId, grant.userId, grant.roleId, grant.ruleId, grant.source, grant.action, grant.matched]);
    await insertAudit(client, audit);
    await client.query('commit');
    return transition;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function activeCount(guildId, userId, roleId, action) {
  const { rows } = await pool().query(
    'select count(*)::int as total from identity_role_grants where guild_id = $1 and user_id = $2 and role_id = $3 and matched = true and action = $4',
    [String(guildId), String(userId), String(roleId), action],
  );
  return rows[0].total;
}

async function getRoleState(guildId, userId, roleId) {
  const { rows } = await pool().query(
    'select bot_added_role, manual_marked, last_known_present from identity_role_state where guild_id = $1 and user_id = $2 and role_id = $3',
    [String(guildId), String(userId), String(roleId)],
  );
  const row = rows[0];
  return { botAddedRole: row?.bot_added_role ?? false, manualMarked: row?.manual_marked ?? false, lastKnownPresent: row?.last_known_present ?? false };
}

/**
 * Notes whether the member has the role right now. A role that is there with no record of the bot adding it, or that came
 * back after the bot saw it gone, was put there by a person: it is marked manual and the bot never takes it away.
 */
async function observeRolePresence(guildId, userId, roleId, present) {
  await pool().query(`
    insert into identity_role_state (guild_id, user_id, role_id, bot_added_role, manual_marked, last_known_present, created_at, updated_at)
    select $1,$2,$3,
      exists (select 1 from identity_role_grants where guild_id = $1 and user_id = $2 and role_id = $3 and bot_added_role = true),
      $4 and not exists (select 1 from identity_role_grants where guild_id = $1 and user_id = $2 and role_id = $3 and bot_added_role = true),
      $4, now(), now()
    on conflict (guild_id, user_id, role_id) do update set
      manual_marked = case
        when $4 = true and identity_role_state.bot_added_role = true and identity_role_state.last_known_present = false then true
        when $4 = true and identity_role_state.bot_added_role = false then true
        else identity_role_state.manual_marked end,
      bot_added_role = case
        when $4 = true and identity_role_state.bot_added_role = true and identity_role_state.last_known_present = false then false
        else identity_role_state.bot_added_role end,
      last_known_present = $4, updated_at = now()`,
    [String(guildId), String(userId), String(roleId), Boolean(present)]);
}

async function markBotAdded(guildId, userId, roleId) {
  const client = await pool().connect();
  try {
    await client.query('begin');
    await client.query(`
      insert into identity_role_state (guild_id, user_id, role_id, bot_added_role, manual_marked, last_known_present, created_at, updated_at)
      values ($1,$2,$3,true,false,true,now(),now())
      on conflict (guild_id, user_id, role_id) do update set bot_added_role = true, manual_marked = false, last_known_present = true, updated_at = now()`,
      [String(guildId), String(userId), String(roleId)]);
    await client.query(
      "update identity_role_grants set bot_added_role = true, updated_at = now() where guild_id = $1 and user_id = $2 and role_id = $3 and action = 'add_role' and matched = true",
      [String(guildId), String(userId), String(roleId)]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function markBotRemoved(guildId, userId, roleId) {
  const client = await pool().connect();
  try {
    await client.query('begin');
    await client.query(
      'update identity_role_state set bot_added_role = false, manual_marked = false, last_known_present = false, updated_at = now() where guild_id = $1 and user_id = $2 and role_id = $3',
      [String(guildId), String(userId), String(roleId)]);
    await client.query(
      'update identity_role_grants set bot_added_role = false, updated_at = now() where guild_id = $1 and user_id = $2 and role_id = $3',
      [String(guildId), String(userId), String(roleId)]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function insertAudit(executor, audit) {
  await executor.query(`
    insert into identity_audit_events (event_type, dedupe_key, guild_id, actor_id, user_id, role_id, rule_id, source_type, action, result, error, metadata, created_at)
    values ($1,$2,nullif($3,''),nullif($4,''),nullif($5,''),nullif($6,''),nullif($7,''),nullif($8,''),nullif($9,''),nullif($10,''),nullif($11,''),$12,now())
    on conflict (dedupe_key) do nothing`,
    [audit.eventType, audit.dedupeKey, audit.guildId ?? '', audit.actorId ?? '', audit.userId ?? '', audit.roleId ?? '', audit.ruleId ?? '', audit.source ?? '', audit.action ?? '', audit.result ?? '', audit.error ?? '', JSON.stringify(audit.metadata ?? {})]);
}
const recordAudit = (audit) => insertAudit(pool(), audit);

// ---- Thank-you messages and logs

async function getNotification(guildId, source) {
  const { rows } = await pool().query('select channel_id, embed_name, ping from identity_notifications where guild_id = $1 and source_type = $2', [String(guildId), source]);
  return rows[0] ? { channelId: rows[0].channel_id, embedName: rows[0].embed_name, ping: rows[0].ping } : null;
}
async function setNotification(guildId, source, { channelId, embedName = '', ping = 'user' }) {
  await pool().query(`
    insert into identity_notifications (guild_id, source_type, channel_id, embed_name, ping, updated_at) values ($1,$2,$3,$4,$5,now())
    on conflict (guild_id, source_type) do update set channel_id = excluded.channel_id, embed_name = excluded.embed_name, ping = excluded.ping, updated_at = now()`,
    [String(guildId), source, String(channelId), embedName, ping]);
}
async function clearNotification(guildId, source) {
  const { rowCount } = await pool().query('delete from identity_notifications where guild_id = $1 and source_type = $2', [String(guildId), source]);
  return rowCount > 0;
}

async function getLogConfig(guildId) {
  const { rows } = await pool().query('select channel_id, events, embeds from identity_logs where guild_id = $1', [String(guildId)]);
  return rows[0] ? { channelId: rows[0].channel_id, events: rows[0].events ?? {}, embeds: rows[0].embeds ?? {} } : null;
}
async function setLogConfig(guildId, { channelId, events, embeds }) {
  await pool().query(`
    insert into identity_logs (guild_id, channel_id, events, embeds, updated_at) values ($1,$2,$3,$4,now())
    on conflict (guild_id) do update set channel_id = excluded.channel_id, events = excluded.events, embeds = excluded.embeds, updated_at = now()`,
    [String(guildId), String(channelId), JSON.stringify(events ?? {}), JSON.stringify(embeds ?? {})]);
}
async function clearLogConfig(guildId) {
  const { rowCount } = await pool().query('delete from identity_logs where guild_id = $1', [String(guildId)]);
  return rowCount > 0;
}

module.exports = {
  newId, listVanityRules, listGuildTagRules, hasActiveRules, managedRoleIds, createRule, updateRule, deleteRule,
  invalidateStaleGrants, managedRolesOfMember, recordGrant, activeCount, getRoleState, observeRolePresence, markBotAdded, markBotRemoved, recordAudit,
  getNotification, setNotification, clearNotification, getLogConfig, setLogConfig, clearLogConfig,
};
