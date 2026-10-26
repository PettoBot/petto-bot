// "Dashboard access" by role: a server can let the members of a role into some parts of the dashboard without Manage Server (the rules
// are in `dash_access`, set on the website's Dashboard access page). For the routes behind those parts (counters, forms), the site says
// that it let the member in (X-Petto-Dashboard-Grant: <page>:<view|edit>), and the bot checks it again with the same rules and the
// member's roles from Discord, so the site's word alone never opens anything. The same sections as the site (petto-web src/utils/dashAccess.ts).
const database = require('../db/database');

const PAGE_SECTIONS = { counters: 'automation', feeds: 'community', forms: 'community', stats: 'dashboard', moderation: 'moderation', tickets: 'tickets' };
// Tickets were part of Community before they had a section of their own: a rule that opens Community still opens them.
const ALSO_OPENED_BY = { tickets: ['community'] };
const GRANT = /^([a-z-]{1,30}):(view|edit)$/;
const RULES_TTL_MS = 10_000;
const cache = new Map();

/** The rules of a server: [{ role_id, sections, can_edit }]. Kept a few seconds. */
async function rulesOf(guildId, now = Date.now()) {
  const hit = cache.get(guildId);
  if (hit && hit.expiresAt > now) return hit.rules;
  const { data, error } = await database.from('dash_access').select('role_id,sections,can_edit').eq('guild_id', guildId);
  if (error) throw error;
  const rules = (data ?? []).map((row) => ({ role_id: String(row.role_id), sections: Array.isArray(row.sections) ? row.sections.map(String) : [], can_edit: Boolean(row.can_edit) }));
  if (cache.size > 5000) cache.clear();
  cache.set(guildId, { rules, expiresAt: now + RULES_TTL_MS });
  return rules;
}

/** Whether rules allow a member's roles to open (`edit` false) or change (`edit` true) a page. */
function rulesAllow(rules, roleIds, page, edit) {
  const section = PAGE_SECTIONS[page];
  if (!section) return false;
  const roles = new Set(roleIds);
  const names = [section, ...(ALSO_OPENED_BY[section] ?? [])];
  return rules.some((rule) => roles.has(rule.role_id) && (rule.sections.includes('*') || names.some((name) => rule.sections.includes(name))) && (!edit || rule.can_edit));
}

/**
 * Whether a member who does not manage the server may use the route of `page` through their roles. `grant` is the site's header; it must
 * name the same page, and `needEdit` routes need an edit grant. Returns false on anything unclear.
 */
async function roleGrantAllows({ guildId, member, page, grant, needEdit }) {
  const match = GRANT.exec(String(grant ?? ''));
  if (!match || match[1] !== page || !member) return false;
  if (needEdit && match[2] !== 'edit') return false;
  const roleIds = [...(member.roles?.cache?.keys?.() ?? [])].filter((id) => id !== guildId);
  if (!roleIds.length) return false;
  try {
    return rulesAllow(await rulesOf(guildId), roleIds, page, needEdit);
  } catch {
    return false;
  }
}

function forgetRules() { cache.clear(); }

module.exports = { roleGrantAllows, rulesAllow, PAGE_SECTIONS, forgetRules };
