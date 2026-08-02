const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const db = require('../../db/tickets');
const settingsDb = require('../../db/ticketSettings');
const actions = require('../../utils/ticketActions');
const { buildPanelRows, buildPanelFallbackCard, buildTranscriptLinkRow } = require('../../utils/ticketCards');
const { build } = require('../../utils/embedBuilder');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');

const STYLE_CHOICES = [
  { name: 'primary (blurple)', value: 'primary' },
  { name: 'secondary (grey)', value: 'secondary' },
  { name: 'success (green)', value: 'success' },
  { name: 'danger (red)', value: 'danger' },
];

module.exports = {
  aliases: ['t', 'tickets'],
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Support ticket system: panels, categories, and per-ticket controls.')
    .setDMPermission(false)

    .addSubcommandGroup((g) =>
      g
        .setName('panel')
        .setDescription('(Staff) Manage ticket panels — the message members click to open a ticket.')
        .addSubcommand((s) =>
          s
            .setName('create')
            .setDescription('Post a new ticket panel in a channel.')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the panel in').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
            .addStringOption((o) => o.setName('title').setDescription('Panel title (ignored if embed_template is set)').setRequired(false))
            .addStringOption((o) => o.setName('description').setDescription('Panel description (ignored if embed_template is set)').setRequired(false))
            .addStringOption((o) => o.setName('embed_template').setDescription('Use a saved /embed template instead of title/description').setRequired(false))
            .addStringOption((o) => o.setName('style').setDescription('Buttons (max 5 categories) or a dropdown (max 25)').addChoices({ name: 'buttons', value: 'button' }, { name: 'dropdown', value: 'select' }).setRequired(false)),
        )
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a panel (and its message, if still present).').addIntegerOption((o) => o.setName('panel_id').setDescription('Panel ID (see /ticket panel list)').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List panels in this server.')),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('category')
        .setDescription('(Staff) Manage ticket categories — what a panel button/option opens.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a category to a panel.')
            .addIntegerOption((o) => o.setName('panel_id').setDescription('Panel to attach this category to').setRequired(true))
            .addStringOption((o) => o.setName('key').setDescription('Short unique id, e.g. "support"').setRequired(true))
            .addStringOption((o) => o.setName('label').setDescription('Button/option label').setRequired(true))
            .addChannelOption((o) => o.setName('parent').setDescription('Category channel new tickets are created under').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
            .addRoleOption((o) => o.setName('support_role').setDescription('Role that can see/manage these tickets (add more with /ticket support-role add)').setRequired(true))
            .addStringOption((o) => o.setName('emoji').setDescription('Emoji for the button/option').setRequired(false))
            .addStringOption((o) => o.setName('style').setDescription('Button color (buttons-style panels only)').addChoices(...STYLE_CHOICES).setRequired(false))
            .addStringOption((o) => o.setName('description').setDescription('Shown under the option (dropdown-style panels only)').setRequired(false))
            .addStringOption((o) => o.setName('welcome_embed').setDescription('Saved /embed template to use as the ticket welcome message').setRequired(false))
            .addIntegerOption((o) => o.setName('max_open').setDescription('Max open tickets per user in this category (default 1)').setMinValue(1).setRequired(false))
            .addStringOption((o) => o.setName('naming').setDescription('Channel naming pattern: {number}, {username} (default "ticket-{number}")').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('edit')
            .setDescription('Edit a category.')
            .addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true))
            .addStringOption((o) => o.setName('label').setDescription('New label').setRequired(false))
            .addChannelOption((o) => o.setName('parent').setDescription('New parent category channel').addChannelTypes(ChannelType.GuildCategory).setRequired(false))
            .addStringOption((o) => o.setName('emoji').setDescription('New emoji').setRequired(false))
            .addStringOption((o) => o.setName('style').setDescription('New button color').addChoices(...STYLE_CHOICES).setRequired(false))
            .addStringOption((o) => o.setName('description').setDescription('New description').setRequired(false))
            .addStringOption((o) => o.setName('welcome_embed').setDescription('New saved /embed template for the welcome message').setRequired(false))
            .addIntegerOption((o) => o.setName('max_open').setDescription('New max open tickets per user').setMinValue(1).setRequired(false))
            .addStringOption((o) => o.setName('naming').setDescription('New channel naming pattern').setRequired(false)),
        )
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a category.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List categories in this server.')),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('support-role')
        .setDescription('(Staff) Roles that can see/manage a category\'s tickets.')
        .addSubcommand((s) => s.setName('add').setDescription('Add a support role to a category.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a support role from a category.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List a category\'s support roles.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true))),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('ping-role')
        .setDescription('(Staff) Roles pinged when a new ticket opens in a category.')
        .addSubcommand((s) => s.setName('add').setDescription('Add a ping role to a category.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a ping role from a category.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List a category\'s ping roles.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true))),
    )

    .addSubcommand((s) => s.setName('open').setDescription('Open a ticket without using a panel.').addStringOption((o) => o.setName('category').setDescription('Category key').setRequired(true)))
    .addSubcommand((s) => s.setName('close').setDescription('Close this ticket.').addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand((s) => s.setName('reopen').setDescription('(Staff) Reopen this closed ticket.'))
    .addSubcommand((s) => s.setName('delete').setDescription('(Staff) Permanently delete this ticket\'s channel.'))
    .addSubcommand((s) => s.setName('claim').setDescription('(Staff) Claim this ticket.'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('(Staff) Release your claim on this ticket.'))
    .addSubcommand((s) => s.setName('add').setDescription('Add a member to this ticket.').addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a member from this ticket.').addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('rename').setDescription('(Staff) Rename this ticket\'s channel.').addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true)))
    .addSubcommand((s) => s.setName('transcript').setDescription('(Staff) Post a transcript of this ticket so far, without closing it.'))
    .addSubcommand((s) => s.setName('info').setDescription('Show info about this ticket.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if (group === 'panel') return panelCmd(interaction, sub);
    if (group === 'category') return categoryCmd(interaction, sub);
    if (group === 'support-role') return roleListCmd(interaction, sub, 'support_role_ids');
    if (group === 'ping-role') return roleListCmd(interaction, sub, 'ping_role_ids');

    if (sub === 'open') return openCmd(interaction);
    if (sub === 'info') return infoCmd(interaction);
    return ticketActionCmd(interaction, sub);
  },
};

/** Replies with a permission error and returns false if the caller lacks Manage Server; true (no reply sent) otherwise. */
async function requireManageGuild(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  await interaction.reply({ content: 'You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
  return false;
}

// ── Panel admin ─────────────────────────────────────────────────────────────

async function panelCmd(interaction, sub) {
  if (!(await requireManageGuild(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const panels = await db.listPanels(interaction.guild.id);
    if (!panels.length) {
      await interaction.editReply({ components: [textCard('No panels yet. Create one with `!ticket panel create`.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const lines = await Promise.all(
      panels.map(async (p) => {
        const cats = await db.listCategories(interaction.guild.id, p.id);
        return `**#${p.id}** in <#${p.channel_id}> (${p.style}) — ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`;
      }),
    );
    await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'delete') {
    const panelId = interaction.options.getInteger('panel_id', true);
    const panel = await db.getPanel(interaction.guild.id, panelId);
    if (!panel) {
      await interaction.editReply({ components: [textCard(`No panel with id \`${panelId}\`.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    if (panel.message_id) {
      const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
      const msg = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
      await msg?.delete().catch(() => {});
    }
    await db.deletePanel(interaction.guild.id, panelId);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Panel #${panelId} deleted.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // create
  const channel = interaction.options.getChannel('channel', true);
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const embedTemplate = interaction.options.getString('embed_template');
  const style = interaction.options.getString('style') ?? 'button';

  if (embedTemplate && !(await getTemplate(interaction.guild.id, embedTemplate))) {
    await interaction.editReply({
      components: [textCard(`${EMOJI.ALERT}  No embed named \`${embedTemplate}\` found. Create it with \`!embed create\` first — the panel was not created.`, 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const panel = await db.createPanel({ guildId: interaction.guild.id, channelId: channel.id, title, description, embedTemplate, style });

  const payload = await renderPanelMessage(interaction.guild, panel, []);
  const message = await channel.send(payload).catch((err) => {
    logger.error('Failed to post ticket panel:', err);
    return null;
  });

  if (!message) {
    await db.deletePanel(interaction.guild.id, panel.id);
    await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  I couldn't post the panel in ${channel}. Check my permissions there.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await db.setPanelMessageId(panel.id, message.id);
  await interaction.editReply({
    components: [textCard(`${EMOJI.APPROVE}  Panel **#${panel.id}** posted in ${channel}. Add categories with \`!ticket category add panel_id:${panel.id}\`.`, 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/** Renders (or re-renders) a panel's message payload: embed-template-or-fallback + its categories' button/select row. */
async function renderPanelMessage(guild, panel, categories) {
  const rows = buildPanelRows(panel.style, categories);

  if (panel.embed_template) {
    const doc = await getTemplate(guild.id, panel.embed_template);
    if (doc) {
      const payload = await build(doc.data, { guild });
      return { content: payload.content, embeds: payload.embeds, components: [...(payload.components ?? []), ...rows] };
    }
  }

  return { components: [buildPanelFallbackCard({ title: panel.title, description: panel.description }), ...rows], flags: MessageFlags.IsComponentsV2 };
}

// ── Category admin ──────────────────────────────────────────────────────────

async function categoryCmd(interaction, sub) {
  if (!(await requireManageGuild(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const categories = await db.listCategories(interaction.guild.id);
    if (!categories.length) {
      await interaction.editReply({ components: [textCard('No categories yet. Create a panel first, then `!ticket category add`.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const lines = categories.map((c) => `**${c.key}** — ${c.label} · panel #${c.panel_id ?? 'none'} · parent <#${c.parent_channel_id}> · ${c.support_role_ids.length} support role(s)`);
    await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const key = interaction.options.getString('key', true);
    const removed = await db.deleteCategory(interaction.guild.id, key);
    await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Category \`${key}\` removed.` : `No category \`${key}\` found.`, removed ? 0xa5ea7a : 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    if (removed) await resyncPanelsForCategoryChange(interaction.guild, key);
    return;
  }

  if (sub === 'edit') {
    const key = interaction.options.getString('key', true);
    const existing = await db.getCategoryByKey(interaction.guild.id, key);
    if (!existing) {
      await interaction.editReply({ components: [textCard(`No category \`${key}\` found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const patch = {};
    const label = interaction.options.getString('label');
    const parent = interaction.options.getChannel('parent');
    const emoji = interaction.options.getString('emoji');
    const style = interaction.options.getString('style');
    const description = interaction.options.getString('description');
    const welcomeEmbed = interaction.options.getString('welcome_embed');
    const maxOpen = interaction.options.getInteger('max_open');
    const naming = interaction.options.getString('naming');

    if (label) patch.label = label;
    if (parent) patch.parent_channel_id = parent.id;
    if (emoji) patch.emoji = emoji;
    if (style) patch.button_style = style;
    if (description) patch.description = description;
    if (welcomeEmbed) patch.welcome_embed_template = welcomeEmbed;
    if (maxOpen) patch.max_open_per_user = maxOpen;
    if (naming) patch.naming_pattern = naming;

    const updated = await db.updateCategory(interaction.guild.id, key, patch);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Category \`${updated.key}\` updated.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    if (label || emoji || style) await resyncPanelsForCategoryChange(interaction.guild, key);
    return;
  }

  // add
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = await db.getPanel(interaction.guild.id, panelId);
  if (!panel) {
    await interaction.editReply({ components: [textCard(`No panel with id \`${panelId}\`.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const key = interaction.options.getString('key', true);
  if (await db.getCategoryByKey(interaction.guild.id, key)) {
    await interaction.editReply({ components: [textCard(`A category with key \`${key}\` already exists.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const welcomeEmbed = interaction.options.getString('welcome_embed');
  if (welcomeEmbed && !(await getTemplate(interaction.guild.id, welcomeEmbed))) {
    await interaction.editReply({ components: [textCard(`${EMOJI.ALERT}  No embed named \`${welcomeEmbed}\` found. Create it with \`!embed create\` first.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const category = await db.createCategory({
    guildId: interaction.guild.id,
    panelId,
    key,
    label: interaction.options.getString('label', true),
    parentChannelId: interaction.options.getChannel('parent', true).id,
    supportRoleIds: [interaction.options.getRole('support_role', true).id],
    emoji: interaction.options.getString('emoji'),
    buttonStyle: interaction.options.getString('style'),
    description: interaction.options.getString('description'),
    welcomeEmbedTemplate: welcomeEmbed,
    maxOpenPerUser: interaction.options.getInteger('max_open'),
    namingPattern: interaction.options.getString('naming'),
  });

  await resyncPanelsForCategoryChange(interaction.guild, category.key);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Category \`${category.key}\` added to panel #${panelId}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

/** Re-renders a panel's live message after one of its categories changes, so the buttons/dropdown stay in sync. */
async function resyncPanelsForCategoryChange(guild, categoryKey) {
  try {
    const category = await db.getCategoryByKey(guild.id, categoryKey);
    if (!category?.panel_id) return;
    const panel = await db.getPanel(guild.id, category.panel_id);
    if (!panel?.message_id) return;

    const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
    if (!message) return;

    const categories = await db.listCategories(guild.id, panel.id);
    const payload = await renderPanelMessage(guild, panel, categories);
    await message.edit(payload);
  } catch (err) {
    logger.warn('Failed to resync ticket panel message:', err.message);
  }
}

async function roleListCmd(interaction, sub, column) {
  if (!(await requireManageGuild(interaction))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const key = interaction.options.getString('key', true);
  const category = await db.getCategoryByKey(interaction.guild.id, key);
  if (!category) {
    await interaction.editReply({ components: [textCard(`No category \`${key}\` found.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'list') {
    const ids = category[column] ?? [];
    const text = ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : 'None configured.';
    await interaction.editReply({ components: [textCard(text, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.options.getRole('role', true);
  const ids = new Set(category[column] ?? []);
  if (sub === 'add') ids.add(role.id);
  else ids.delete(role.id);

  await db.updateCategory(interaction.guild.id, key, { [column]: [...ids] });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role} ${sub === 'add' ? 'added to' : 'removed from'} \`${key}\`.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

// ── Ticket actions ───────────────────────────────────────────────────────────

async function openCmd(interaction) {
  const key = interaction.options.getString('category', true);
  const category = await db.getCategoryByKey(interaction.guild.id, key);
  if (!category) {
    await interaction.reply({ content: `No ticket category \`${key}\` exists here.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await actions.openTicketInteractive(interaction, category);
}

async function infoCmd(interaction) {
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: 'This isn\'t a ticket channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  const category = await db.getCategoryById(ticket.category_id);
  const lines = [
    `### Ticket #${ticket.ticket_number}`,
    `**Category:** ${category?.label ?? 'Unknown'}`,
    `**Opened by:** <@${ticket.opener_id}>`,
    `**Status:** ${ticket.status}`,
    `**Claimed by:** ${ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Nobody yet'}`,
    `**Opened:** <t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:R>`,
  ];
  if (ticket.status === 'closed') {
    lines.push(`**Closed by:** <@${ticket.closed_by}>`, `**Close reason:** ${ticket.close_reason || 'No reason provided.'}`);
  }

  await interaction.reply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

/** Shared entry point for close/reopen/delete/claim/unclaim/add/remove/rename/transcript — all operate on "the ticket in this channel". */
async function ticketActionCmd(interaction, sub) {
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: 'This isn\'t a ticket channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  const category = await db.getCategoryById(ticket.category_id);
  const isStaff = actions.isStaffForCategory(interaction.member, category ?? { support_role_ids: [] });
  const isOpener = interaction.user.id === ticket.opener_id;

  const staffOnly = ['reopen', 'delete', 'claim', 'unclaim', 'rename', 'transcript'];
  const openerOrStaff = ['close', 'add', 'remove'];

  if (staffOnly.includes(sub) && !isStaff) {
    await interaction.reply({ content: 'Only staff for this ticket\'s category can do that.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (openerOrStaff.includes(sub) && !isStaff && !isOpener) {
    await interaction.reply({ content: 'Only the ticket opener or staff can do that.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'close' && !isStaff) {
    const settings = await settingsDb.getSettings(interaction.guild.id);
    if (settings.close_requires_support_role) {
      await interaction.reply({ content: 'Only staff for this ticket can close it.', flags: MessageFlags.Ephemeral });
      return;
    }
  }

  if (sub === 'close' && ticket.status === 'closed') {
    await interaction.reply({ content: 'This ticket is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'reopen' && ticket.status !== 'closed') {
    await interaction.reply({ content: 'This ticket is not closed.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user };

  try {
    switch (sub) {
      case 'close': {
        const reason = interaction.options.getString('reason');
        await actions.closeTicket({ ...ctx, reason });
        await interaction.editReply({ content: `${EMOJI.DENY} Ticket closed.` });
        return;
      }
      case 'reopen':
        await actions.reopenTicket(ctx);
        await interaction.editReply({ content: `${EMOJI.APPROVE} Ticket reopened.` });
        return;
      case 'delete':
        await interaction.editReply({ content: `${EMOJI.HAMMER} Deleting this channel...` });
        await actions.deleteTicketChannel(ctx);
        return;
      case 'claim':
        if (ticket.claimed_by) {
          await interaction.editReply({ content: `Already claimed by <@${ticket.claimed_by}>.` });
          return;
        }
        await actions.claimTicket(ctx);
        await interaction.editReply({ content: `${EMOJI.STAR} You claimed this ticket.` });
        return;
      case 'unclaim':
        await actions.unclaimTicket(ctx);
        await interaction.editReply({ content: 'Claim released.' });
        return;
      case 'add': {
        const targetUser = interaction.options.getUser('user', true);
        await actions.addMember({ ...ctx, targetUser });
        await interaction.editReply({ content: `${EMOJI.APPROVE} Added ${targetUser} to this ticket.` });
        return;
      }
      case 'remove': {
        const targetUser = interaction.options.getUser('user', true);
        await actions.removeMember({ ...ctx, targetUser });
        await interaction.editReply({ content: `${EMOJI.APPROVE} Removed ${targetUser} from this ticket.` });
        return;
      }
      case 'rename': {
        const newName = interaction.options.getString('name', true);
        const finalName = await actions.renameTicket({ ...ctx, newName });
        await interaction.editReply({ content: `${EMOJI.APPROVE} Renamed to \`${finalName}\`.` });
        return;
      }
      case 'transcript': {
        const { link } = await actions.postTranscript(ctx);
        const linkRow = buildTranscriptLinkRow(link);
        await interaction.editReply({ content: `${EMOJI.APPROVE} Transcript posted to the ticket log.`, components: linkRow ? [linkRow] : [] });
        return;
      }
    }
  } catch (err) {
    if (err.userFacing) {
      await interaction.editReply({ content: err.message });
      return;
    }
    logger.error(`Ticket action "${sub}" failed:`, err);
    await interaction.editReply({ content: 'Something went wrong performing that action.' });
  }
}
