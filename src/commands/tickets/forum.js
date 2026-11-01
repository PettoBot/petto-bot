// Forum support: `!forum` (prefix only, no slash command). The tools of a post (lock, close, solved...), the setup of a forum and its panel.
// Inside a post, the author and the staff use `!forum close`, `!forum solved`... (`!tl` is `!forum lock`); who may use each one is in
// utils/forumAccess.js. The setup commands need Manage Server.
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const forumsDb = require('../../db/forums');
const { ensureGuild } = require('../../db/guilds');
const config = require('../../utils/forumConfig');
const access = require('../../utils/forumAccess');
const actions = require('../../utils/forumActions');
const cards = require('../../utils/forumCards');
const { resolveRoles } = require('../../utils/roleResolve');
const { register, sendPager } = require('../../utils/pager');
const { permissionName } = require('../../utils/permissionLabels');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const { problem } = actions;
const MANAGE = PermissionFlagsBits.ManageGuild;
// What a change to these settings shows on the panel (the message is drawn again).
const PANEL_COLUMNS = new Set(['panel_title', 'panel_description', 'panel_footer', 'panel_image', 'panel_color', 'panel_template', 'button_label', 'button_emoji', 'button_style', 'ask_images', 'enabled']);

const settingOption = (o) => o.setName('setup').setDescription('The name of the forum setup (needed when the server has more than one)').setRequired(false);

const STATUS_EMOJI = { open: EMOJI.TICKET_REOPEN, solved: EMOJI.APPROVE, locked: EMOJI.TICKET_CLOSE, closed: EMOJI.DENY, all: EMOJI.ALL };

// ── the list of posts (`!forum list`) ───────────────────────────────────────────────────────────────────────────────────

register('forumposts', {
  perPage: 10,
  async load(guild, { option, arg, lang }) {
    const status = ['open', 'solved', 'locked', 'closed', 'all'].includes(option) ? option : 'open';
    const posts = await forumsDb.listPosts(guild.id, { status: status === 'all' ? null : status, setupId: /^\d+$/.test(arg) ? arg : null, limit: 200 });
    return {
      title: t(lang, 'forums.list.title'),
      subtitle: [t(lang, 'forums.list.subtitle', { status: t(lang, status === 'all' ? 'forums.list.all' : `forums.status.${status}`) })],
      items: posts.map((post) => cards.postLine(post, lang)),
      empty: t(lang, 'forums.list.empty'),
      options: ['open', 'solved', 'locked', 'closed', 'all'].map((value) => ({ value, label: t(lang, value === 'all' ? 'forums.list.all' : `forums.status.${value}`), emoji: STATUS_EMOJI[value] })),
      placeholder: t(lang, 'forums.list.show.menu'),
    };
  },
});

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const quiet = { parse: [], repliedUser: false };

/** The language and the usual pieces of a tool: the post, its setup and index row, and what the member may do (or an error that says no). */
async function toolContext(interaction, tool) {
  const lang = interaction.pettoLang ?? await languageOf(interaction);
  const channel = interaction.channel;
  if (!access.isForumPost(channel)) throw problem(lang, 'forums.error.notForumPost');
  const ctx = await actions.loadContext(channel);
  ctx.lang = lang;
  const member = interaction.member;
  const who = access.rolesIn(member, channel, ctx);
  if (!ctx.setup && !who.moderator) throw problem(lang, 'forums.error.notSetUp');
  // The hierarchy only matters to a staff member who has a role and not Manage Threads: the author is looked for in memory, and asked for when needed.
  let authorMember = null;
  if (who.staffByRole && !who.moderator && !who.author && who.authorId) authorMember = await actions.fetchMember(ctx.guild, who.authorId);
  const verdict = access.authorize(tool, member, channel, { setup: ctx.setup, post: ctx.post, authorMember, guild: ctx.guild });
  if (!verdict.ok) throw problem(lang, `forums.deny.${verdict.reason}`);
  return { ...ctx, who: verdict.who, actor: member.id };
}

/** The setup a setup command is about: the named one, the only one of the server, or the one of the forum it was typed in. */
async function pickSetup(interaction, lang) {
  const named = interaction.options.getString('setup');
  const all = await forumsDb.listSetups(interaction.guild.id);
  if (named) {
    const found = all.find((setup) => setup.name === named.toLowerCase() || String(setup.id) === named);
    if (!found) throw problem(lang, 'forums.error.setupUnknown', { name: named.slice(0, 40), names: all.map((setup) => `\`${setup.name}\``).join(', ') || '-' });
    return found;
  }
  if (all.length === 1) return all[0];
  const here = interaction.channel?.isThread?.() ? interaction.channel.parentId : interaction.channelId;
  const byPlace = all.find((setup) => setup.forum_channel_id === here);
  if (byPlace) return byPlace;
  if (!all.length) throw problem(lang, 'forums.error.noSetups', { prefix: interaction.typedPrefix ?? '!' });
  throw problem(lang, 'forums.error.pickSetup', { names: all.map((setup) => `\`${setup.name}\``).join(', ') });
}

function needManageGuild(interaction, lang) {
  if (!interaction.member.permissions.has(MANAGE)) throw problem(lang, 'forums.deny.manageGuild');
}

const reply = (interaction, payload) => interaction.reply(payload);

// ── the tools of a post ─────────────────────────────────────────────────────────────────────────────────────────────────

const TOOLS = {
  async lock(interaction) {
    const ctx = await toolContext(interaction, 'lock');
    const reason = interaction.options.getString('reason');
    await actions.lockPost(ctx, { actor: ctx.actor, reason });
    await reply(interaction, cards.buildDone('locked', { actor: ctx.actor, thread: ctx.thread.id, reason, lang: ctx.lang }));
  },

  async unlock(interaction) {
    const ctx = await toolContext(interaction, 'unlock');
    await actions.unlockPost(ctx, { actor: ctx.actor });
    await reply(interaction, cards.buildDone('unlocked', { actor: ctx.actor, thread: ctx.thread.id, lang: ctx.lang }));
  },

  async close(interaction) {
    const ctx = await toolContext(interaction, 'close');
    const reason = interaction.options.getString('reason');
    await actions.closePost(ctx, { actor: ctx.actor, reason, announce: () => reply(interaction, cards.buildDone('closed', { actor: ctx.actor, thread: ctx.thread.id, reason, lang: ctx.lang })) });
  },

  async reopen(interaction) {
    const ctx = await toolContext(interaction, 'reopen');
    await actions.reopenPost(ctx, { actor: ctx.actor });
    await reply(interaction, cards.buildDone('reopened', { actor: ctx.actor, thread: ctx.thread.id, lang: ctx.lang }));
  },

  async solved(interaction) {
    const ctx = await toolContext(interaction, 'solved');
    const { post } = await actions.solvePost(ctx, { actor: ctx.actor });
    const later = ctx.setup && ctx.setup.solved_action !== 'none'
      ? t(ctx.lang, 'forums.done.solvedLater', { action: t(ctx.lang, `forums.action.${ctx.setup.solved_action}`), time: `<t:${Math.floor(new Date(post?.solved_at ?? Date.now()).getTime() / 1000 + ctx.setup.solved_delay_hours * 3600)}:R>` })
      : null;
    await reply(interaction, cards.buildDone('solved', { actor: ctx.actor, thread: ctx.thread.id, note: later, lang: ctx.lang }));
  },

  async unsolved(interaction) {
    const ctx = await toolContext(interaction, 'unsolved');
    await actions.unsolvePost(ctx, { actor: ctx.actor });
    await reply(interaction, cards.buildDone('unsolved', { actor: ctx.actor, thread: ctx.thread.id, lang: ctx.lang }));
  },

  async rename(interaction) {
    const ctx = await toolContext(interaction, 'rename');
    const name = await actions.renamePost(ctx, interaction.options.getString('title', true), { actor: ctx.actor });
    await reply(interaction, cards.buildDone('renamed', { actor: ctx.actor, thread: ctx.thread.id, extra: { title: name.replace(/[*_`~|>]/g, '') }, lang: ctx.lang }));
  },

  async claim(interaction) {
    const ctx = await toolContext(interaction, 'claim');
    await actions.claimPost(ctx, { actor: ctx.actor, moderator: ctx.who.moderator });
    await reply(interaction, cards.buildClaim({ staff: ctx.actor, lang: ctx.lang }));
  },

  async unclaim(interaction) {
    const ctx = await toolContext(interaction, 'unclaim');
    await actions.unclaimPost(ctx, { actor: ctx.actor, moderator: ctx.who.moderator });
    await reply(interaction, cards.buildDone('unclaimed', { actor: ctx.actor, thread: ctx.thread.id, lang: ctx.lang }));
  },

  async tag(interaction) {
    const action = interaction.options.getSubcommand();
    if (action === 'list') {
      const lang = interaction.pettoLang ?? await languageOf(interaction);
      if (!access.isForumPost(interaction.channel)) throw problem(lang, 'forums.error.notForumPost');
      const forum = interaction.channel.parent;
      const on = new Set(interaction.channel.appliedTags ?? []);
      const lines = (forum.availableTags ?? []).map((tag) => `- ${on.has(tag.id) ? '**' : ''}${tag.name}${on.has(tag.id) ? '**' : ''}${tag.moderated ? ` (${t(lang, 'forums.tag.moderated')})` : ''}`);
      await reply(interaction, cards.buildDescriptionCard(`${t(lang, 'forums.tag.list', { emoji: EMOJI.TICKET, post: `<#${interaction.channel.id}>` })}\n${lines.join('\n') || t(lang, 'forums.tag.none')}`));
      return;
    }
    const ctx = await toolContext(interaction, 'tag');
    const reference = interaction.options.getString('tag', true);
    const tag = action === 'add' ? await actions.addTag(ctx, reference, { actor: ctx.actor }) : await actions.removeTag(ctx, reference, { actor: ctx.actor });
    await reply(interaction, cards.buildDone(action === 'add' ? 'tagAdded' : 'tagRemoved', { actor: ctx.actor, thread: ctx.thread.id, extra: { tag: tag.name }, lang: ctx.lang }));
  },

  async list(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    const all = await forumsDb.listSetups(interaction.guild.id);
    const member = interaction.member;
    const staff = member.permissions.has(PermissionFlagsBits.ManageThreads) || all.some((setup) => (setup.staff_role_ids ?? []).some((id) => member.roles.cache.has(id)));
    if (!staff) throw problem(lang, 'forums.deny.staffOnly');
    const status = (interaction.options.getString('status') ?? 'open').toLowerCase();
    const picked = ['open', 'solved', 'locked', 'closed', 'all'].includes(status) ? status : 'open';
    await sendPager(interaction, 'forumposts', { option: picked, arg: '' });
  },

  /** A message of a normal channel becomes a post of the forum (by reply, by link or by id). */
  async move(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    const all = await forumsDb.listSetups(interaction.guild.id);
    if (!all.length) throw problem(lang, 'forums.error.noSetups', { prefix: interaction.typedPrefix ?? '!' });
    const parsed = config.parseMoveArgs(interaction.options.getString('text') ?? '', all.map((setup) => setup.name));
    const { guild, member } = interaction;

    // The forum: the one named, the only one of the server.
    let setup = null;
    if (parsed.forum) setup = all.find((item) => item.name === String(parsed.forum).toLowerCase() || item.forum_channel_id === parsed.forum || guild.channels.cache.get(item.forum_channel_id)?.name === String(parsed.forum).toLowerCase()) ?? null;
    else if (all.length === 1) setup = all[0];
    if (!setup) throw problem(lang, parsed.forum ? 'forums.error.moveForum' : 'forums.error.moveWhere', { names: all.map((item) => `\`${item.name}\``).join(', ') });

    const verdict = access.authorize('move', member, interaction.channel, { setup });
    if (!verdict.ok) throw problem(lang, `forums.deny.${verdict.reason}`);

    // The message: by link, by id (in this channel) or the one that was replied to.
    const raw = interaction.rawMessage;
    let source = null;
    if (parsed.message?.channelId) {
      if (parsed.message.guildId !== guild.id) throw problem(lang, 'forums.error.moveOtherServer');
      const channel = guild.channels.cache.get(parsed.message.channelId) ?? await guild.channels.fetch(parsed.message.channelId).catch(() => null);
      if (!channel?.messages || !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) throw problem(lang, 'forums.error.moveNoMessage');
      source = await channel.messages.fetch(parsed.message.messageId).catch(() => null);
    } else if (parsed.message?.messageId) {
      source = await interaction.channel.messages.fetch(parsed.message.messageId).catch(() => null);
    } else if (raw?.reference?.messageId) {
      source = await raw.fetchReference().catch(() => null);
    }
    if (!source) throw problem(lang, 'forums.error.moveNoMessage', { prefix: interaction.typedPrefix ?? '!' });
    if (source.author?.bot) throw problem(lang, 'forums.error.moveBot');

    const { thread } = await actions.movePost({ guild, setup, message: source, staff: member, title: parsed.title, lang });
    const done = cards.buildDone('moved', { actor: member.id, thread: thread.id, lang });
    // The answer goes under the message that was moved, so its author sees where it went; when that is not possible it goes under the command.
    const pointer = { ...done, allowedMentions: { parse: [], users: [source.author.id], repliedUser: false } };
    const sent = await source.reply(pointer).catch(() => null);
    if (!sent) await reply(interaction, done);
  },
};

// ── the setup of a forum ────────────────────────────────────────────────────────────────────────────────────────────────

const SETUP_TOOLS = {
  async setup(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    needManageGuild(interaction, lang);
    const { guild } = interaction;
    const forum = interaction.options.getChannel('forum', true);
    if (forum.type !== ChannelType.GuildForum) throw problem(lang, 'forums.error.notForum', { channel: `<#${forum.id}>` });
    await ensureGuild(guild.id);
    const existing = await forumsDb.getSetupByForum(guild.id, forum.id);
    if (existing) throw problem(lang, 'forums.error.setupExists', { name: existing.name, prefix: interaction.typedPrefix ?? '!' });
    if (await forumsDb.countSetups(guild.id) >= config.MAX_SETUPS) throw problem(lang, 'forums.error.setupLimit', { max: config.MAX_SETUPS });
    const taken = new Set((await forumsDb.listSetups(guild.id)).map((setup) => setup.name));
    const wanted = config.slugName(interaction.options.getString('name') || forum.name) || 'forum';
    let name = wanted;
    for (let n = 2; taken.has(name); n += 1) name = `${wanted.slice(0, 29)}-${n}`;
    let setup = await forumsDb.createSetup(guild.id, { name, forum_channel_id: forum.id });
    // The tag that means solved: the one the forum has, or a new one when the bot may edit the forum.
    const solved = await actions.ensureSolvedTag(forum, setup, lang).catch(() => null);
    if (solved) setup = (await forumsDb.updateSetup(guild.id, setup.id, { solved_tag_id: solved.id })) ?? setup;
    const missing = actions.botMissing(forum, config.REQUIRED_PERMISSIONS).map((flag) => permissionName(flag, lang));
    const optionalMissing = actions.botMissing(forum, config.OPTIONAL_PERMISSIONS).map((flag) => permissionName(flag, lang));
    await reply(interaction, cards.buildStatus(setup, { forum, missing, optionalMissing, lang, prefix: interaction.typedPrefix ?? '!' }));
  },

  async set(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    needManageGuild(interaction, lang);
    const setup = await pickSetup(interaction, lang);
    const key = interaction.options.getString('setting', true).toLowerCase();
    const parsed = config.parseSetting(key, interaction.options.getString('value', true), { roles: (text) => resolveRoles(interaction.guild, text).resolved.map((role) => role.id) });
    if (!parsed.ok) throw problem(lang, `forums.set.${parsed.key}`, { ...parsed.vars, settings: Object.keys(config.SETTINGS).join(', ') });
    const patch = config.normalizeSetup(parsed.patch);
    const saved = await forumsDb.updateSetup(interaction.guild.id, setup.id, patch);
    if (!saved) throw problem(lang, 'forums.error.setupUnknown', { name: setup.name, names: '-' });
    if (Object.keys(patch).some((column) => PANEL_COLUMNS.has(column))) await actions.refreshPanel(interaction.guild, saved, lang).catch(() => false);
    await reply(interaction, cards.buildDone('set', { actor: interaction.member.id, thread: saved.forum_channel_id, extra: { setting: key, name: saved.name }, lang }));
  },

  async panel(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    needManageGuild(interaction, lang);
    const setup = await pickSetup(interaction, lang);
    const asked = interaction.options.getChannel('channel');
    const channel = asked ?? (setup.panel_channel_id ? null : interaction.channel);
    const result = await actions.postPanel({ guild: interaction.guild, setup, channel, lang });
    if (!result.ok) throw problem(lang, `forums.panel.error.${result.error}`, { prefix: interaction.typedPrefix ?? '!' });
    await reply(interaction, cards.buildDone(result.edited ? 'panelUpdated' : 'panelPosted', { actor: interaction.member.id, thread: result.message.channelId, extra: { url: result.message.url, name: setup.name }, lang }));
  },

  async status(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    needManageGuild(interaction, lang);
    const setup = await pickSetup(interaction, lang);
    const forum = await actions.fetchForum(interaction.guild, setup.forum_channel_id);
    const missing = forum ? actions.botMissing(forum, config.REQUIRED_PERMISSIONS).map((flag) => permissionName(flag, lang)) : [];
    const optionalMissing = forum ? actions.botMissing(forum, config.OPTIONAL_PERMISSIONS).map((flag) => permissionName(flag, lang)) : [];
    const panelUrl = setup.panel_channel_id && setup.panel_message_id ? `https://discord.com/channels/${interaction.guild.id}/${setup.panel_channel_id}/${setup.panel_message_id}` : null;
    await reply(interaction, cards.buildStatus(setup, { forum, missing, optionalMissing, lang, panelUrl, prefix: interaction.typedPrefix ?? '!' }));
  },

  async enable(interaction) { return switchSetup(interaction, true); },
  async disable(interaction) { return switchSetup(interaction, false); },

  async delete(interaction) {
    const lang = interaction.pettoLang ?? await languageOf(interaction);
    needManageGuild(interaction, lang);
    const setup = await pickSetup(interaction, lang);
    // The panel goes with it; the posts stay in the forum (only what Petto keeps about them is deleted).
    const channel = setup.panel_channel_id ? (interaction.guild.channels.cache.get(setup.panel_channel_id) ?? null) : null;
    const message = channel?.messages && setup.panel_message_id ? await channel.messages.fetch(setup.panel_message_id).catch(() => null) : null;
    if (message && message.author?.id === interaction.client.user.id) await message.delete().catch(() => {});
    await forumsDb.deleteSetup(interaction.guild.id, setup.id);
    await reply(interaction, cards.buildDone('deleted', { actor: interaction.member.id, thread: setup.forum_channel_id, extra: { name: setup.name }, lang }));
  },
};

async function switchSetup(interaction, enabled) {
  const lang = interaction.pettoLang ?? await languageOf(interaction);
  needManageGuild(interaction, lang);
  const setup = await pickSetup(interaction, lang);
  if (setup.enabled === enabled) throw problem(lang, enabled ? 'forums.error.alreadyOn' : 'forums.error.alreadyOff', { name: setup.name });
  const saved = await forumsDb.updateSetup(interaction.guild.id, setup.id, { enabled });
  await actions.refreshPanel(interaction.guild, saved ?? { ...setup, enabled }, lang).catch(() => false);
  await reply(interaction, cards.buildDone(enabled ? 'enabled' : 'disabled', { actor: interaction.member.id, thread: setup.forum_channel_id, extra: { name: setup.name }, lang }));
}

// ── the command ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const data = new SlashCommandBuilder()
  .setName('forum')
  .setDescription('Forum support: panel, posts and the tools to lock, close and solve them.')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('lock').setDescription('Lock this post: only moderators can write in it (also !tl).').addStringOption((o) => o.setName('reason').setDescription('Why it is locked').setRequired(false)))
  .addSubcommand((s) => s.setName('unlock').setDescription('Let members write in this post again.'))
  .addSubcommand((s) => s.setName('close').setDescription('Close this post: it is locked and archived.').addStringOption((o) => o.setName('reason').setDescription('Why it is closed').setRequired(false)))
  .addSubcommand((s) => s.setName('reopen').setDescription('Open a closed or locked post again.'))
  .addSubcommand((s) => s.setName('solved').setDescription('Mark this post as solved (the Solved tag goes on it).'))
  .addSubcommand((s) => s.setName('unsolved').setDescription('Take the Solved tag off this post.'))
  .addSubcommand((s) => s.setName('rename').setDescription('Give this post a new title.').addStringOption((o) => o.setName('title').setDescription('The new title').setRequired(true)))
  .addSubcommandGroup((g) => g.setName('tag').setDescription('The tags of this post.')
    .addSubcommand((s) => s.setName('add').setDescription('Put a tag of the forum on this post.').addStringOption((o) => o.setName('tag').setDescription('The name of the tag').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Take a tag off this post.').addStringOption((o) => o.setName('tag').setDescription('The name of the tag').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('The tags of the forum and the ones this post has.')))
  .addSubcommand((s) => s.setName('claim').setDescription('Say that you handle this post.'))
  .addSubcommand((s) => s.setName('unclaim').setDescription('Stop handling this post.'))
  .addSubcommand((s) => s.setName('move').setDescription('Turn a message into a post of the forum (reply to it, or give its link).').addStringOption((o) => o.setName('text').setDescription('The link of the message, the forum and a title (all optional)').setRequired(false)))
  .addSubcommand((s) => s.setName('list').setDescription('The posts of the forums of this server (staff).').addStringOption((o) => o.setName('status').setDescription('open, solved, locked, closed or all').setRequired(false)))
  .addSubcommand((s) => s.setName('panel').setDescription('Post the panel with the button that opens a post (or update it).')
    .addChannelOption((o) => o.setName('channel').setDescription('The channel for the panel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
    .addStringOption(settingOption))
  .addSubcommand((s) => s.setName('setup').setDescription('Set up a forum channel for support posts.')
    .addChannelOption((o) => o.setName('forum').setDescription('The forum channel').addChannelTypes(ChannelType.GuildForum).setRequired(true))
    .addStringOption((o) => o.setName('name').setDescription('A short name for this setup').setRequired(false)))
  .addSubcommand((s) => s.setName('set').setDescription('Change one setting of a setup (see the wiki for the list).')
    .addStringOption((o) => o.setName('setting').setDescription('The setting, like max-open or solved-action').setRequired(true))
    .addStringOption((o) => o.setName('value').setDescription('The new value (none clears it)').setRequired(true))
    .addStringOption(settingOption))
  .addSubcommand((s) => s.setName('status').setDescription('How a setup is set and what the bot is missing.').addStringOption(settingOption))
  .addSubcommand((s) => s.setName('enable').setDescription('Let members open posts with the panel again.').addStringOption(settingOption))
  .addSubcommand((s) => s.setName('disable').setDescription('Stop members from opening posts with the panel.').addStringOption(settingOption))
  .addSubcommand((s) => s.setName('delete').setDescription('Remove a setup (the posts stay in the forum).').addStringOption(settingOption));

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['forums'],
  data,
  // Anyone can type it: the checks of each tool are in forumAccess.js. The setup commands need Manage Server.
  prefixPermissionOverrides: { setup: MANAGE, set: MANAGE, panel: MANAGE, status: MANAGE, enable: MANAGE, disable: MANAGE, delete: MANAGE },
  prefixGreedyStringOptions: { set: 'value', lock: 'reason', close: 'reason', rename: 'title', move: 'text' },
  TOOLS,
  SETUP_TOOLS,

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = group ?? interaction.options.getSubcommand();
    const run = TOOLS[sub] ?? SETUP_TOOLS[sub];
    if (!run) throw new Error(`Unknown subcommand ${sub}`); // i18n-ignore: never reached, the parser only gives the declared ones
    await run(interaction);
  },
};
