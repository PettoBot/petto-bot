// i18n-ignore-file: Petto team operator command (English).
const { SlashCommandBuilder } = require('discord.js');
const { EMOJI } = require('../../utils/emojis');
const store = require('../../db/guildBlacklist');
const blacklist = require('../../utils/guildBlacklist');
const { isTeam, findGuild, notFoundText, guildLine, protectedGuildIds, opsNote, oneLine, teamReply, SNOWFLAKE_RE } = require('../../utils/teamTools');

const RED = 0xfe6465;
const YELLOW = 0xfed53c;
const GREEN = 0xa5ea7a;
const NOTICE = { owner_dm: 'the owner was told by direct message', channel: 'the owner could not be written to, so a channel of the server was told', null: 'the owner could NOT be told (no direct message, no channel)' };
const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

const USAGE = [
  '`!blacklist <server id or name> <reason>` adds a server (reason: 5 to 500 characters). A name with spaces goes in quotes: `!blacklist "My Server" <reason>`.',
  '`!blacklist remove <server id or name>` takes it off the list.',
  '`!blacklist list [page]` shows the list: reason, who added it, when, and whether Petto is still in it.',
  '`!blacklist info <server id or name>` shows one entry.',
  '`petto blacklist ...` works the same.',
].join('\n');

/** The servers of Petto called exactly like `name` (any case), for the parser. */
const namesOf = (client) => (name) => [...client.guilds.cache.values()].filter((guild) => String(guild.name ?? '').toLowerCase() === String(name).toLowerCase());

/** One entry for the list or for `info`: facts only, nothing that can ping. */
function entryLines(entry, client, { long = false } = {}) {
  const guild = client.guilds.cache.get(String(entry.guild_id));
  const name = oneLine(guild?.name ?? entry.guild_name, 80) || 'unknown name';
  const head = `**${name}** (\`${entry.guild_id}\`)`;
  const by = entry.fromEnvironment ? 'the host (environment)' : `\`${oneLine(entry.added_by, 25)}\``;
  const when = entry.added_at ? `<t:${unix(entry.added_at)}:R>` : 'at start';
  const inside = guild ? 'Petto is **still in it**' : 'Petto is not in it';
  if (!long) return `${head} · by ${by} · ${when} · ${inside}${entry.attempts ? ` · ${entry.attempts} attempt(s) to add Petto` : ''}\n> ${oneLine(entry.reason, 140)}`;
  return [
    head,
    `**Reason:** ${oneLine(entry.reason, 500)}`,
    `**Added by:** ${by} · ${when}`,
    `**Owner:** ${entry.owner_id ? `\`${entry.owner_id}\`` : 'unknown'}${guild ? ` · **Members:** ${guild.memberCount ?? 'unknown'}` : ''}`,
    `**Petto:** ${inside}${entry.left_at ? ` · left <t:${unix(entry.left_at)}:R>` : ''}`,
    `**Owner told:** ${entry.notified_at ? `<t:${unix(entry.notified_at)}:R>` : 'never'}`,
    `**Attempts to add Petto again:** ${entry.attempts ?? 0}${entry.last_attempt_at ? ` · last <t:${unix(entry.last_attempt_at)}:R>` : ''}`,
    ...(entry.fromEnvironment ? ['-# Listed by the host, so it is not in the table: take the ID out of the environment to remove it.'] : []),
  ].join('\n');
}

/** An entry named by an ID, by the name of a server Petto is in, or by the name it had when it was listed. Returns the entry, or `{ error }`. */
function entryFor(client, target) {
  const text = String(target ?? '').trim();
  if (!text) return { error: 'Give the server ID or its name. Try `!blacklist list`.' };
  if (SNOWFLAKE_RE.test(text)) return store.entryOf(text) ? { entry: store.entryOf(text) } : { error: `\`${text}\` is not on the blacklist.` };
  const wanted = text.toLowerCase();
  const found = store.entries().filter((entry) => String(client.guilds.cache.get(String(entry.guild_id))?.name ?? entry.guild_name ?? '').toLowerCase() === wanted);
  if (found.length === 1) return { entry: found[0] };
  return { error: found.length ? `${found.length} listed servers are called **${oneLine(text)}**: use the ID.` : `No listed server is called **${oneLine(text)}**. Use the ID.` };
}

async function add(interaction, parsed) {
  const client = interaction.client;
  const checked = blacklist.checkReason(parsed.reason);
  if (!checked.ok) {
    const why = { missing: 'A reason is required: say what rule the server broke.', short: `The reason is too short (at least ${blacklist.LIMITS.reasonMin} characters).`, long: `The reason is too long (${checked.length} characters, at most ${blacklist.LIMITS.reasonMax}).` }[checked.error];
    return teamReply(interaction, `${EMOJI.WARNING} ${why}\n${USAGE}`, YELLOW);
  }
  const found = await findGuild(client, parsed.target.id ?? parsed.target.name, { fetch: false });
  if (!found.ok) return teamReply(interaction, `${EMOJI.WARNING} ${notFoundText(found, parsed.target.name)}`, YELLOW);
  if ((await protectedGuildIds(client)).has(found.id)) return teamReply(interaction, `${EMOJI.DENY} That is the operations or support server of Petto: it cannot be blacklisted.`, RED);
  if (store.isBlacklisted(found.id)) return teamReply(interaction, `${EMOJI.WARNING} That server is already blacklisted. See it with \`!blacklist info ${found.id}\`, or remove it first to change the reason.`, YELLOW);

  await interaction.deferReply?.();
  const result = await blacklist.blacklistGuild(client, { guildId: found.id, reason: checked.reason, addedBy: interaction.user.id });
  if (!result.created) return teamReply(interaction, `${EMOJI.WARNING} That server is already blacklisted.`, YELLOW);
  const lines = [`${EMOJI.APPROVE} Blacklisted ${guildLine(found.guild, found.id)}.`, `**Reason:** ${oneLine(checked.reason, 500)}`];
  if (!result.present) lines.push('Petto is not in that server. If it is added, Petto leaves at once and the owner is told (once a day at most).');
  else lines.push(`Petto was in it: ${NOTICE[result.noticeBy ?? 'null']}, and ${result.left ? 'Petto **left**' : `Petto **could not leave** (check the log; try \`!leaveguild ${found.id}\`)`}. The team channel has a note.`);
  return teamReply(interaction, lines.join('\n'), result.present && !result.left ? YELLOW : GREEN);
}

async function remove(interaction, parsed) {
  const target = entryFor(interaction.client, parsed.target);
  if (target.error) return teamReply(interaction, `${EMOJI.WARNING} ${target.error}`, YELLOW);
  const id = String(target.entry.guild_id);
  const { removed, stillByEnvironment } = await blacklist.unblacklistGuild(id);
  if (!removed && !stillByEnvironment) return teamReply(interaction, `${EMOJI.WARNING} That server was not on the list.`, YELLOW);
  if (!removed) return teamReply(interaction, `${EMOJI.WARNING} \`${id}\` is listed by the host (the environment), not in the table: take it out of the environment to remove it.`, YELLOW);
  await opsNote(interaction.client, `**Server taken off the blacklist.**\nName: ${oneLine(target.entry.guild_name, 80) || 'unknown'} · ID: \`${id}\`\nBy: <@${interaction.user.id}> (\`${interaction.user.id}\`)`);
  const extra = stillByEnvironment ? '\n-# It is ALSO listed by the host (the environment), so it stays blacklisted.' : '';
  return teamReply(interaction, `${EMOJI.APPROVE} \`${id}\` is off the blacklist. Petto does not go back by itself: the server can add it again.${extra}`, GREEN);
}

async function list(interaction, parsed) {
  const entries = await store.list();
  if (!entries.length) return teamReply(interaction, 'The blacklist is empty.', null);
  const pages = Math.max(1, Math.ceil(entries.length / blacklist.LIMITS.perPage));
  const page = Math.min(parsed.page, pages);
  const slice = entries.slice((page - 1) * blacklist.LIMITS.perPage, page * blacklist.LIMITS.perPage);
  const lines = slice.map((entry, index) => `${(page - 1) * blacklist.LIMITS.perPage + index + 1}. ${entryLines(entry, interaction.client)}`);
  return teamReply(interaction, [`### Blacklisted servers (${entries.length})`, ...lines, `-# Page ${page} of ${pages}${pages > 1 ? ` · \`!blacklist list ${page % pages + 1}\` for the next` : ''}`].join('\n'), null);
}

async function info(interaction, parsed) {
  const target = entryFor(interaction.client, parsed.target);
  if (target.error) return teamReply(interaction, `${EMOJI.WARNING} ${target.error}`, YELLOW);
  return teamReply(interaction, `### Blacklisted server\n${entryLines(target.entry, interaction.client, { long: true })}`, null);
}

/** Private control of the Petto team: the blacklist of servers that break the terms. Prefix only, hidden everywhere, and nobody outside the team gets an answer. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  hiddenEverywhere: true,
  teamOnly: true,
  team: {
    summary: 'Blacklists servers that break the terms: Petto leaves them, tells the owner why, and leaves again if they add it back.',
    usage: ['!blacklist <server id or name> <reason>', '!blacklist remove <server>', '!blacklist list [page]', '!blacklist info <server>'],
    who: 'owner and developers',
  },
  // The text keeps its quotes and spaces: the reason is free text and the name of a server may have spaces.
  prefixRawOptions: { _: (text) => ({ text: String(text ?? '') }) },
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Private control: blacklist servers that break the terms of service.')
    .setDMPermission(false)
    .addStringOption((option) => option.setName('text').setDescription('A server and a reason, or remove, list or info.').setRequired(false)),

  async execute(interaction) {
    // Nobody else gets an answer: for everybody outside the team this is not a command (it is hidden everywhere), and this is the second lock.
    if (!isTeam(interaction.user?.id)) return undefined;
    const parsed = blacklist.parseBlacklistText(interaction.options.getString('text'), { names: namesOf(interaction.client) });
    if (parsed.action === 'help') return teamReply(interaction, `### Blacklist\n${USAGE}`, null);
    if (parsed.action === 'list') return list(interaction, parsed);
    if (parsed.action === 'info') return info(interaction, parsed);
    if (parsed.action === 'remove') return remove(interaction, parsed);
    return add(interaction, parsed);
  },
};
