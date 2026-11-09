const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const config = require('../../config');
const { getUserPremium, assignPremiumSlot, unassignPremiumSlot } = require('../../db/premium');
const { manageableGuilds, canManage, findGuild } = require('../../utils/premiumServers');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { DASHBOARD_URL } = require('../../utils/links');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

// The statuses with a name in the catalogs (`info.premium.status.<key>`); any other is shown as it is stored.
const STATUS_KEYS = { active: 'active', pending: 'pending', past_due: 'pastDue', canceled: 'canceled', expired: 'expired', free: 'free' };

// What any member can see here (the status card and its errors) is translated. The owner actions of Premium (grant, assign, unassign, revoke) are NOT part of this
// command any more (they showed in the `/` menu, `/bot premium` included): they are the hidden prefix-only tool `!premiumadmin` (premiumadmin.js), and the old words
// `!premium grant ...` are sent there by `prefixWords`.

const V2 = MessageFlags.IsComponentsV2;
/** How long the buttons and menus of the status stay (the card stays, without them). */
const CONTROLS_MS = 5 * 60 * 1000;
const premiumUrl = () => 'https://petto.sbs/premium';
const card = (interaction, text, color, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

module.exports = {
  // For scripts/check-premium-status.js: the card of the status.
  buildStatusCardForCheck: (...args) => buildStatusCard(...args),
  registerSlash: true,
  // A slash command (global) and a prefix command: `/premium add` and `!premium add` give a Premium slot to a server where the person is an administrator.
  prefixDefaultSubcommand: 'status',
  // The old owner words keep working for the owner (`!premium grant @user 3` is `!premiumadmin grant @user 3`); for everybody else they are not a command.
  prefixWords: Object.fromEntries(['grant', 'assign', 'unassign', 'revoke'].map((word) => [word, { command: 'premiumadmin', args: [word] }])),
  aliases: ['prem'],
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Your Petto Premium: its status, and which servers have it.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show Premium status for yourself or another user.')
      .addUserOption((option) => option.setName('user').setDescription('User to inspect (default: you)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Give a Premium slot to a server where you are an administrator (this one by default).')
      .addStringOption((option) => option.setName('server').setDescription('The server: pick it from the list (default: this one)').setAutocomplete(true).setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Take your Premium slot back from a server.')
      .addStringOption((option) => option.setName('server').setDescription('The server: pick it from the list (default: this one)').setAutocomplete(true).setRequired(false)))
    .addSubcommand((sub) => sub.setName('servers').setDescription('List the servers that have your Premium and how many slots you have left.'))
    .addSubcommand((sub) => sub.setName('info').setDescription('See the Premium plans and how to give it to a server.')),

  /** The list of the `server` option: for `add`, the servers the person manages (Premium or not); for `remove`, the servers that hold one of their slots. */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'server') return interaction.respond([]);
    const typed = String(focused.value ?? '').toLowerCase().trim();
    const mine = new Set((await getUserPremium(interaction.user.id).catch(() => ({ assignments: [] }))).assignments.map((assignment) => String(assignment.guild_id)));
    let guilds;
    if (interaction.options.getSubcommand(false) === 'remove') {
      guilds = [...mine].map((id) => interaction.client.guilds.cache.get(id)).filter((guild) => guild && (!typed || guild.name.toLowerCase().includes(typed)));
    } else {
      guilds = await manageableGuilds(interaction.client, interaction.user.id, typed);
    }
    const choices = guilds.slice(0, 25).map((guild) => ({ name: `${mine.has(guild.id) ? '★ ' : ''}${guild.name}`.slice(0, 100), value: guild.id }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand(false) ?? 'status';
    try {
      if (subcommand === 'status') return status(interaction, lang);
      if (subcommand === 'add') return addServer(interaction, lang);
      if (subcommand === 'remove') return removeServer(interaction, lang);
      if (subcommand === 'servers') return listServers(interaction, lang);
      if (subcommand === 'info') return info(interaction, lang);
      return replyError(interaction, t(lang, 'info.premium.unknownAction'));
    } catch (error) {
      logger.error(`Premium command failed for ${interaction.user?.id ?? 'unknown user'}:`, error);
      return replyError(interaction, t(lang, 'info.premium.failed'));
    }
  },
};

// The owner may read the status of anybody (a member reads only their own): this is a look, not a team action.
function isOwner(interaction) {
  return interaction.user?.id === config.ownerId;
}

async function status(interaction, lang) {
  const requested = interaction.options.getUser('user');
  if (requested && requested.id !== interaction.user.id && !isOwner(interaction)) {
    return replyError(interaction, t(lang, 'info.premium.ownStatusOnly'));
  }
  const user = requested ?? interaction.user;
  const own = user.id === interaction.user.id;
  const draw = async (note = null) => {
    const premium = await getUserPremium(user.id);
    const controls = own ? await controlsFor(interaction, user, premium, lang) : [];
    return { components: [buildStatusCard(interaction, user, premium, lang, { note, controls })], flags: V2, allowedMentions: { parse: [] } };
  };
  const msg = await interaction.reply(await draw());
  // Only for the person looking at their own status: the buttons and the menus change their slots right there, and the card is drawn again with what happened.
  if (!own || typeof msg?.createMessageComponentCollector !== 'function') return msg;
  const collector = msg.createMessageComponentCollector({ time: CONTROLS_MS });
  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) { await i.reply({ content: t(lang, 'info.premium.notYours', { emoji: EMOJI.WARNING }), flags: MessageFlags.Ephemeral }).catch(() => {}); return; }
    try {
      await i.deferUpdate();
      let result = null;
      if (i.customId === 'premium_add_here') result = await giveSlot(i.client, i.user, interaction.guild, lang);
      else if (i.customId === 'premium_remove_here') result = await takeSlot(i.client, i.user, interaction.guild, lang);
      else if (i.customId === 'premium_add_pick') result = await giveSlot(i.client, i.user, i.client.guilds.cache.get(i.values?.[0]), lang);
      else if (i.customId === 'premium_remove_pick') result = await takeSlot(i.client, i.user, i.client.guilds.cache.get(i.values?.[0]), lang);
      await i.editReply(await draw(result?.text ?? null));
    } catch (err) {
      logger.error(`Premium control failed for ${i.user?.id}:`, err);
      await i.followUp({ content: t(lang, 'info.premium.failed'), flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
  // When the time is up the controls go away and the card stays as it was.
  collector.on('end', async (_c, reason) => {
    if (reason === 'messageDelete') return;
    const premium = await getUserPremium(user.id).catch(() => null);
    if (premium) await msg.edit({ components: [buildStatusCard(interaction, user, premium, lang, { controls: [] })], flags: V2, allowedMentions: { parse: [] } }).catch(() => {});
  });
  return msg;
}

/**
 * The rows under the card of your own status: a button to give a slot to this server (or take it back), a menu to give one to another server you manage, and a menu to take
 * one back from a server that holds it. Only what can be done now is there (no slots left: no menu to add; no server: no menu to remove).
 */
async function controlsFor(interaction, user, premium, lang) {
  const rows = [];
  const held = new Set(premium.assignments.map((assignment) => String(assignment.guild_id)));
  const free = premium.active && premium.slotsUsed < premium.slotsTotal;
  const here = interaction.guild;
  if (here) {
    const holds = held.has(here.id);
    const can = holds || (free && (await canManage(here, user.id)));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(holds ? 'premium_remove_here' : 'premium_add_here').setStyle(holds ? ButtonStyle.Danger : ButtonStyle.Success)
        .setLabel(t(lang, holds ? 'info.premium.removeHere.button' : 'info.premium.addHere.button')).setDisabled(!can),
    ));
  }
  if (free) {
    const choices = (await manageableGuilds(interaction.client, user.id, '')).filter((guild) => !held.has(guild.id));
    if (choices.length) {
      rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('premium_add_pick').setPlaceholder(t(lang, 'info.premium.addPick.menu'))
        .addOptions(choices.slice(0, 25).map((guild) => new StringSelectMenuOptionBuilder().setLabel(guild.name.slice(0, 100)).setValue(guild.id)))));
    }
  }
  const mine = premium.assignments.map((assignment) => interaction.client.guilds.cache.get(String(assignment.guild_id))).filter(Boolean);
  if (mine.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('premium_remove_pick').setPlaceholder(t(lang, 'info.premium.removePick.menu'))
      .addOptions(mine.slice(0, 25).map((guild) => new StringSelectMenuOptionBuilder().setLabel(guild.name.slice(0, 100)).setValue(guild.id)))));
  }
  return rows;
}

/**
 * The status as a Components V2 card (it was an embed): the title, what it means and the avatar of the person on top, then the plans, the period and the slots, the
 * servers that have it, a quiet line saying how to give a slot, and two link buttons. The color follows the state: green active, yellow when something is wrong, none when free.
 */
function buildStatusCard(interaction, user, premium, lang, { note = null, controls = [] } = {}) {
  const entitlement = premium.entitlement;
  const status = STATUS_KEYS[premium.status] ? t(lang, `info.premium.status.${STATUS_KEYS[premium.status]}`) : premium.status;
  const accent = premium.active ? COLORS.GREEN : premium.status === 'free' ? null : COLORS.YELLOW;
  const assigned = premium.assignments.length ? serverList(interaction, premium.assignments) : t(lang, 'info.premium.noServers');
  const period = premium.active
    ? (premium.expiresAt ? `<t:${Math.floor(new Date(premium.expiresAt).getTime() / 1000)}:F>` : t(lang, 'info.premium.permanent'))
    : entitlement?.current_period_end ? `<t:${Math.floor(new Date(entitlement.current_period_end).getTime() / 1000)}:F>` : '—';
  const plans = planNames(premium) || (entitlement?.plan_key ?? t(lang, 'info.premium.status.free'));
  const text = (content) => new TextDisplayBuilder().setContent(content);

  const headText = text(`### ${t(lang, 'info.premium.title', { status })}\n${t(lang, premium.active ? 'info.premium.description.active' : 'info.premium.description.inactive')}\n-# <@${user.id}> · \`${user.id}\``);
  const avatar = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : null;
  const container = new ContainerBuilder();
  // The avatar sits beside the title; a user with no picture to show gets the title alone.
  if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headText).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else container.addTextDisplayComponents(headText);
  container
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(`**${t(lang, 'info.premium.field.plan')}**\n${plans}\n\n**${t(lang, 'info.premium.field.period')}**\n${period}\n\n**${t(lang, 'info.premium.field.slots')}**\n\`${premium.slotsUsed} / ${premium.slotsTotal}\``))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(`**${t(lang, 'info.premium.field.servers')}**\n${assigned}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(`-# ${t(lang, 'info.premium.footer')}`));
  if (note) container.addTextDisplayComponents(text(note));
  for (const row of controls) container.addActionRowComponents(row);
  container
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'info.premium.dashboard.button')).setURL(`${DASHBOARD_URL}/premium`),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'info.premium.plans.button')).setURL(premiumUrl()),
    ));
  return accent === null ? container : container.setAccentColor(accent);
}

/** Every server that has a slot, one a line; when they do not fit in a field of the card, the last line says how many more there are (`+3`). */
function serverList(interaction, assignments) {
  const lines = assignments.map((assignment) => formatGuild(interaction, assignment.guild_id));
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const next = text ? `${text}\n${lines[i]}` : lines[i];
    if (next.length > 980) return `${text}\n+${lines.length - i}`;
    text = next;
  }
  return text;
}

/** The plans of every active Premium of the person (one when they have one), each once with how many times it counts. */
function planNames(premium) {
  const counts = new Map();
  for (const each of premium.activeEntitlements ?? []) counts.set(each.plan_key ?? '—', (counts.get(each.plan_key ?? '—') ?? 0) + 1);
  return [...counts].map(([plan, count]) => (count > 1 ? `${plan} ×${count}` : plan)).join('\n').slice(0, 1024);
}

function formatGuild(interaction, guildId) {
  const guild = interaction.client.guilds.cache.get(guildId);
  return guild ? `**${guild.name}** · \`${guildId}\`` : `\`${guildId}\``;
}

async function replyError(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.RED).setDescription(`⚠️ ${content}`)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** The server of the option (an ID from the list, a name or an ID typed with the prefix), or this one. Null when it is not a server Petto is in. */
function serverOf(interaction) {
  const typed = interaction.options.getString('server');
  return typed ? findGuild(interaction.client, typed) : interaction.guild;
}

/**
 * Gives a slot of `user` to `guild`: what happened as `{ ok, text }` (a text of the catalogs, already in the language), so the command and the buttons of the card say the same.
 * The person must have an active Premium and own the server or manage it (checked here, not only in the list of the option).
 */
async function giveSlot(client, user, guild, lang) {
  if (!guild) return { ok: false, text: t(lang, 'info.premium.add.noServer', { emoji: EMOJI.DENY }) };
  const premium = await getUserPremium(user.id);
  if (!premium.active) return { ok: false, text: t(lang, 'info.premium.add.noPremium', { emoji: EMOJI.DENY, url: premiumUrl() }) };
  if (!(await canManage(guild, user.id))) return { ok: false, text: t(lang, 'info.premium.add.notAdmin', { emoji: EMOJI.DENY, server: guild.name }) };
  const result = await assignPremiumSlot(user.id, guild.id);
  if (!result.ok) {
    const key = { server_taken: 'taken', no_slots: 'noSlots', no_active_entitlement: 'noPremium' }[result.code];
    if (!key) throw new Error(`premium assign: ${result.code}`); // i18n-ignore: an internal error for the log
    return { ok: false, text: t(lang, `info.premium.add.${key}`, { emoji: EMOJI.DENY, server: guild.name, used: result.used, limit: result.limit, url: premiumUrl() }) };
  }
  const after = await getUserPremium(user.id);
  return { ok: true, text: t(lang, result.already ? 'info.premium.add.already' : 'info.premium.add.done', { emoji: EMOJI.APPROVE, server: guild.name, used: after.slotsUsed, total: after.slotsTotal }) };
}

/** Takes the slot of `user` back from `guild`. */
async function takeSlot(client, user, guild, lang) {
  if (!guild) return { ok: false, text: t(lang, 'info.premium.add.noServer', { emoji: EMOJI.DENY }) };
  const result = await unassignPremiumSlot(user.id, guild.id, client);
  if (!result.ok) {
    if (result.code === 'no_assignment') return { ok: false, text: t(lang, 'info.premium.remove.none', { emoji: EMOJI.DENY, server: guild.name }) };
    throw new Error(`premium unassign: ${result.code}`); // i18n-ignore: an internal error for the log
  }
  const after = await getUserPremium(user.id);
  return { ok: true, text: t(lang, 'info.premium.remove.done', { emoji: EMOJI.APPROVE, server: guild.name, used: after.slotsUsed, total: after.slotsTotal }) };
}

async function addServer(interaction, lang) {
  const result = await giveSlot(interaction.client, interaction.user, serverOf(interaction), lang);
  return card(interaction, result.text, result.ok ? 0xa5ea7a : 0xfe6465, !result.ok);
}

async function removeServer(interaction, lang) {
  const result = await takeSlot(interaction.client, interaction.user, serverOf(interaction), lang);
  return card(interaction, result.text, result.ok ? 0xa5ea7a : 0xfe6465, !result.ok);
}

async function listServers(interaction, lang) {
  const premium = await getUserPremium(interaction.user.id);
  const lines = premium.assignments.map((assignment) => `- ${formatGuild(interaction, assignment.guild_id)}`);
  const text = lines.length ? serverList(interaction, premium.assignments).split('\n').map((line) => (line.startsWith('+') ? line : `- ${line}`)).join('\n') : t(lang, 'info.premium.noServers');
  return card(interaction, `${t(lang, 'info.premium.servers.title', { used: premium.slotsUsed, total: premium.slotsTotal })}\n${text}`);
}

async function info(interaction, lang) {
  return card(interaction, t(lang, 'info.premium.info', { url: premiumUrl(), dashboard: `${DASHBOARD_URL}/premium` }));
}
