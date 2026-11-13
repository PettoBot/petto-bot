// i18n-ignore-file: Petto team operator tool (English): the answers of `!blacklist reporter ...` are read by the team only.
// Blocks a person from sending DM reports to the Petto team (reports of a message that Petto sent them): `!blacklist reporter <person> [reason]`, `remove`, `info` and `list`.
// The card of a report has a button for the same thing (interactions/dmTeam.js). A blocked person is told that they cannot send reports, not why and not by whom.
// This file only decides what the team is answered; the command (commands/utility/blacklist.js) draws the answer. Written in TypeScript: `npm run build:ts` compiles it over reportBlocks.js.
import { DEFAULT_REASON, LIMITS } from '../db/dmReportBlocks';
import type { Client } from 'discord.js';
import type { BlockRow } from '../db/dmReportBlocks';

type Store = Pick<typeof import('../db/dmReportBlocks'), 'add' | 'remove' | 'get' | 'list' | 'count'>;

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const teamTools = require('./teamTools') as {
  isTeam(userId: string | undefined): boolean;
  opsNote(client: Client, text: string): Promise<unknown>;
  oneLine(value: unknown, max?: number): string;
};

/** How the answer is drawn: `good` something was done, `warn` it was not (and why), `plain` information. */
export type Tone = 'good' | 'warn' | 'plain';
export interface Answer { text: string; tone: Tone }

export type Parsed =
  | { action: 'help' }
  | { action: 'list'; page: number }
  | { action: 'remove'; target: string }
  | { action: 'info'; target: string }
  | { action: 'add'; target: string; reason: string };

export const USAGE = [
  '`!blacklist reporter <person> [reason]` blocks a person (a mention or an ID) from sending DM reports. Without a reason it says "false or abusive DM reports".',
  '`!blacklist reporter remove <person>` lets them send reports again.',
  '`!blacklist reporter info <person>` shows one block.',
  '`!blacklist reporter list [page]` shows who is blocked.',
  'The card of a report has a **Block reporter** button for the same. A blocked person is told they cannot send reports now (not why, not by whom). Servers keep their own reports.',
].join('\n');

const MENTION = /^<@!?(\d{15,25})>$/;
const ID = /^\d{15,25}$/;

/** The ID of a person written as a mention (`<@id>`) or as the ID itself; null for anything else. */
export function userIdOf(word: unknown): string | null {
  const text = String(word ?? '').trim();
  const mention = MENTION.exec(text);
  if (mention) return mention[1];
  return ID.test(text) ? text : null;
}

/** What follows `!blacklist reporter`: nothing or `help`, `list [page]`, `remove <person>`, `info <person>`, or `<person> [reason]`. */
export function parseReporterText(text: unknown): Parsed {
  const rest = String(text ?? '').trim().replace(/^reporter\b/i, '').trim();
  if (!rest || /^help$/i.test(rest)) return { action: 'help' };
  const [first, ...others] = rest.split(/\s+/);
  const word = first.toLowerCase();
  if (word === 'list') return { action: 'list', page: Math.max(1, Number.parseInt(others[0] ?? '', 10) || 1) };
  if (word === 'remove' || word === 'unblock' || word === 'delete') return { action: 'remove', target: others[0] ?? '' };
  if (word === 'info') return { action: 'info', target: others[0] ?? '' };
  return { action: 'add', target: first, reason: others.join(' ').trim() };
}

/** Is the text for this tool (`reporter ...`)? The word has to stand alone: a server called "reporters" is another thing. */
export const isReporterText = (text: unknown): boolean => /^\s*reporter(\s|$)/i.test(String(text ?? ''));

const warn = (text: string): Answer => ({ text, tone: 'warn' });
const unix = (value: string | Date): number => Math.floor(new Date(value).getTime() / 1000);

/** One block for the list or for `info`: who, why, who blocked them and when. Facts only, nothing that can ping. */
export function blockLines(row: BlockRow, { long = false }: { long?: boolean } = {}): string {
  const who = `\`${row.user_id}\`${row.user_tag ? ` (\`${teamTools.oneLine(row.user_tag, 40)}\`)` : ''}`;
  const by = `\`${teamTools.oneLine(row.blocked_by, 25)}\``;
  const when = `<t:${unix(row.created_at)}:R>`;
  if (!long) return `${who} · by ${by} · ${when}\n> ${teamTools.oneLine(row.reason, 140)}`;
  return [
    who,
    `**Reason:** ${teamTools.oneLine(row.reason, LIMITS.reasonMax)}`,
    `**Blocked by:** ${by} · ${when}`,
    ...(row.report_id ? [`**From report:** #${row.report_id}`] : []),
  ].join('\n');
}

/** The reason as the team wrote it, or the default; `error` says why it cannot be used (null when it can). */
export function cleanReason(text: unknown): { ok: boolean; reason: string; error: string | null } {
  const reason = String(text ?? '').replace(/\s+/g, ' ').trim() || DEFAULT_REASON;
  if (reason.length < LIMITS.reasonMin) return { ok: false, reason, error: `The reason is too short (at least ${LIMITS.reasonMin} characters).` };
  if (reason.length > LIMITS.reasonMax) return { ok: false, reason, error: `The reason is too long (${reason.length} characters, at most ${LIMITS.reasonMax}).` };
  return { ok: true, reason, error: null };
}

/** Why this person cannot be blocked (a text), or null: nobody of the team and no bot (the report button is for people). */
export function refusalFor(userId: string, user: { bot?: boolean } | null, clientUserId: string | undefined): string | null {
  if (teamTools.isTeam(userId)) return 'That person is on the Petto team: they cannot be blocked.';
  if (userId === clientUserId || user?.bot) return 'That is a bot: only people send reports.';
  return null;
}

const ago = (row: BlockRow): string => `<t:${unix(row.created_at)}:R>`;

/**
 * Runs `!blacklist reporter ...` and answers what to say. `by` is the person of the team; `store` is the table of blocks (a check gives its own).
 * Every change leaves a note in the operations channel of the team (who, whom, why), like the blacklist of servers does.
 */
export async function reporterCommand(text: unknown, { client, by, store }: { client: Client; by: string; store: Store }): Promise<Answer> {
  const parsed = parseReporterText(text);
  if (parsed.action === 'help') return { text: `### Blocked reporters\n${USAGE}`, tone: 'plain' };

  if (parsed.action === 'list') {
    const total = await store.count();
    if (!total) return { text: 'Nobody is blocked from sending DM reports.', tone: 'plain' };
    const pages = Math.max(1, Math.ceil(total / LIMITS.perPage));
    const page = Math.min(parsed.page, pages);
    const rows = await store.list({ limit: LIMITS.perPage, offset: (page - 1) * LIMITS.perPage });
    const lines = rows.map((row, index) => `${(page - 1) * LIMITS.perPage + index + 1}. ${blockLines(row)}`);
    return { text: [`### Blocked reporters (${total})`, ...lines, `-# Page ${page} of ${pages}${pages > 1 ? ` · \`!blacklist reporter list ${(page % pages) + 1}\` for the next` : ''}`].join('\n'), tone: 'plain' };
  }

  const id = userIdOf(parsed.target);
  if (!id) return warn(`Give the person as a mention or an ID.\n${USAGE}`);

  if (parsed.action === 'info') {
    const row = await store.get(id);
    return row ? { text: `### Blocked reporter\n${blockLines(row, { long: true })}`, tone: 'plain' } : warn(`\`${id}\` is not blocked.`);
  }

  if (parsed.action === 'remove') {
    const row = await store.remove(id);
    if (!row) return warn(`\`${id}\` was not blocked.`);
    await teamTools.opsNote(client, `**Reporter unblocked.**\nPerson: \`${id}\`${row.user_tag ? ` (\`${teamTools.oneLine(row.user_tag, 40)}\`)` : ''}\nBy: <@${by}> (\`${by}\`)`).catch(() => null);
    return { text: `\`${id}\` can send DM reports again.`, tone: 'good' };
  }

  const checked = cleanReason(parsed.reason);
  if (!checked.ok) return warn(`${checked.error}\n${USAGE}`);
  const user = await client.users.fetch(id).catch(() => null);
  if (!user) return warn(`I could not find a user with the ID \`${id}\`.`);
  const refusal = refusalFor(id, user, client.user?.id);
  if (refusal) return warn(refusal);
  const row = await store.add({ userId: id, userTag: user.username ?? null, reason: checked.reason, by });
  if (!row) return warn(`\`${id}\` is already blocked. See it with \`!blacklist reporter info ${id}\`, or remove the block first to change the reason.`);
  await teamTools.opsNote(client, `**Reporter blocked.**\nPerson: \`${id}\` (\`${teamTools.oneLine(user.username, 40)}\`)\nReason: ${teamTools.oneLine(checked.reason, 300)}\nBy: <@${by}> (\`${by}\`)`).catch(() => null);
  return { text: `\`${id}\` (\`${teamTools.oneLine(user.username, 40)}\`) is blocked from sending DM reports ${ago(row)}.\n**Reason:** ${teamTools.oneLine(checked.reason, 300)}\n-# They are told they cannot send reports, not why. \`!blacklist reporter remove ${id}\` undoes it.`, tone: 'good' };
}
