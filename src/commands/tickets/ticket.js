// Ticket panel setup, access rules, and ticket lifecycle actions.
const { summarizeStats, durationText } = require('../../utils/ticketReminders');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const db = require('../../db/tickets');
const formsDb = require('../../db/ticketForms');
const { renderWizard, startDraft: startSetupDraft } = require('../../interactions/ticketSetupWizard');
const { renderPanel: renderFormPanel, startDraft } = require('../../interactions/ticketFormPanel');
const accessDb = require('../../db/ticketAccess');
const settingsDb = require('../../db/ticketSettings');
const actions = require('../../utils/ticketActions');
const { buildPanelRows, buildPanelFallbackCard, buildTranscriptLinkRow, buildCloseRequestRow } = require('../../utils/ticketCards');
const { build } = require('../../utils/embedBuilder');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { guildLimit } = require('../../db/premium');
const { t, tn, formatNumber, languageOf, defaultText } = require('../../i18n');

const STYLE_CHOICES = [
  { name: 'primary (blurple)', value: 'primary' },
  { name: 'secondary (grey)', value: 'secondary' },
  { name: 'success (green)', value: 'success' },
  { name: 'danger (red)', value: 'danger' },
];

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
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
            .addStringOption((o) => o.setName('style').setDescription('Buttons (max 5 categories) or a dropdown (max 25)').addChoices({ name: 'buttons', value: 'button' }, { name: 'dropdown', value: 'select' }).setRequired(false))
            .addStringOption((o) => o.setName('color').setDescription('Color of the card as a hex, like a5ea7a').setRequired(false))
            .addStringOption((o) => o.setName('image').setDescription('A picture on top of the panel (a link that starts with https)').setRequired(false))
            .addStringOption((o) => o.setName('footer').setDescription('A small text under the panel').setRequired(false)),
        )
        .addSubcommand((s) => s
          .setName('edit')
          .setDescription('Change how a panel looks and update its message.')
          .addIntegerOption((o) => o.setName('panel_id').setDescription('Panel ID (see ticket panel list)').setRequired(true))
          .addStringOption((o) => o.setName('title').setDescription('New title (none removes it)').setRequired(false))
          .addStringOption((o) => o.setName('description').setDescription('New description (none removes it)').setRequired(false))
          .addStringOption((o) => o.setName('color').setDescription('Color of the card as a hex, like a5ea7a (none for the usual green)').setRequired(false))
          .addStringOption((o) => o.setName('image').setDescription('A picture on top (a link that starts with https, none removes it)').setRequired(false))
          .addStringOption((o) => o.setName('footer').setDescription('A small text under the panel (none removes it)').setRequired(false))
          .addStringOption((o) => o.setName('placeholder').setDescription('Text of the dropdown before choosing (none for the usual)').setRequired(false))
          .addStringOption((o) => o.setName('style').setDescription('Buttons or a dropdown').addChoices({ name: 'buttons', value: 'button' }, { name: 'dropdown', value: 'select' }).setRequired(false)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a panel (and its message, if still present).').addIntegerOption((o) => o.setName('panel_id').setDescription('Panel ID (see /ticket panel list)').setRequired(true)))
        .addSubcommand((s) => s.setName('resend').setDescription('Delete and repost a panel with its current categories.').addIntegerOption((o) => o.setName('panel_id').setDescription('Panel ID (see /ticket panel list)').setRequired(true)))
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
            .addStringOption((o) => o.setName('form').setDescription('Reusable form name (see !ticket form list)').setRequired(false))
            .addRoleOption((o) => o.setName('required_role').setDescription('Role required to open this category').setRequired(false))
            .addStringOption((o) => o.setName('naming').setDescription('Channel name: {number}, {username}, {userid}, {category} (default "ticket-{number}")').setRequired(false))
            .addStringOption((o) => o.setName('welcome').setDescription('Welcome text in the ticket: {user}, {username}, {category}, {server}, {number}').setMaxLength(1000).setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('edit')
            .setDescription('Change a ticket category: its label, emoji, color, welcome text, form and more.')
            .addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true))
            .addStringOption((o) => o.setName('label').setDescription('New label').setRequired(false))
            .addChannelOption((o) => o.setName('parent').setDescription('New parent category channel').addChannelTypes(ChannelType.GuildCategory).setRequired(false))
            .addStringOption((o) => o.setName('emoji').setDescription('New emoji').setRequired(false))
            .addStringOption((o) => o.setName('style').setDescription('New button color').addChoices(...STYLE_CHOICES).setRequired(false))
            .addStringOption((o) => o.setName('description').setDescription('New description').setRequired(false))
            .addStringOption((o) => o.setName('welcome_embed').setDescription('New saved /embed template for the welcome message').setRequired(false))
            .addIntegerOption((o) => o.setName('max_open').setDescription('New max open tickets per user').setMinValue(1).setRequired(false))
            .addStringOption((o) => o.setName('form').setDescription('Form name, or "none" to remove').setRequired(false))
            .addRoleOption((o) => o.setName('required_role').setDescription('Required role to add').setRequired(false))
            .addStringOption((o) => o.setName('naming').setDescription('New channel name: {number}, {username}, {userid}, {category}').setRequired(false))
            .addStringOption((o) => o.setName('welcome').setDescription('New welcome text ({user}, {username}, {category}, {server}, {number}), or "none"').setMaxLength(1000).setRequired(false)),
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

    .addSubcommandGroup((g) =>
      g
        .setName('required-role')
        .setDescription('(Staff) Roles required to open a category.')
        .addSubcommand((s) => s.setName('add').setDescription('Require a role for a category.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Required role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a required role.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Required role').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List required roles.').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true))),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('form')
        .setDescription('(Staff) Manage reusable ticket intake forms.')
        .addSubcommand((s) => s.setName('create').setDescription('Create a form with buttons, or give the fields as type|id|label|placeholder|required;...').addStringOption((o) => o.setName('name').setDescription('Form name').setRequired(true)).addStringOption((o) => o.setName('fields').setDescription('Optional: 1-5 fields separated by ; (leave empty to use the buttons)').setRequired(false)).addStringOption((o) => o.setName('title').setDescription('Modal title').setRequired(false)))
        .addSubcommand((s) => s.setName('edit').setDescription('Edit a form with buttons, or give the replacement fields.').addStringOption((o) => o.setName('name').setDescription('Form name').setRequired(true)).addStringOption((o) => o.setName('fields').setDescription('Optional: replacement fields separated by ;').setRequired(false)).addStringOption((o) => o.setName('title').setDescription('New modal title').setRequired(false)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a ticket form and its questions.').addStringOption((o) => o.setName('name').setDescription('Form name').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List ticket forms.')),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('blacklist')
        .setDescription('(Staff) Block users or roles from opening tickets.')
        .addSubcommand((s) => s.setName('add').setDescription('Add a user or role to the ticket blacklist.').addUserOption((o) => o.setName('user').setDescription('User to block').setRequired(false)).addRoleOption((o) => o.setName('role').setDescription('Role to block').setRequired(false)).addStringOption((o) => o.setName('reason').setDescription('Optional reason').setRequired(false)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a user or role from the ticket blacklist.').addUserOption((o) => o.setName('user').setDescription('User to unblock').setRequired(false)).addRoleOption((o) => o.setName('role').setDescription('Role to unblock').setRequired(false)))
        .addSubcommand((s) => s.setName('list').setDescription('List blocked users and roles.')),
    )

    .addSubcommand((s) => s.setName('setup').setDescription('(Staff) Guided ticket setup with menus and buttons.'))
    .addSubcommand((s) => s.setName('priority').setDescription('(Staff) Set how urgent this ticket is.').addStringOption((o) => o.setName('level').setDescription('Priority').addChoices({ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }, { name: 'Urgent', value: 'urgent' }).setRequired(true)))
    .addSubcommand((s) => s.setName('transfer').setDescription('(Staff) Hand this ticket to another staff member.').addUserOption((o) => o.setName('user').setDescription('Staff member who takes over').setRequired(true)))
    .addSubcommand((s) => s.setName('note').setDescription('(Staff) Add a private note to this ticket, or list the notes if you write none.').addStringOption((o) => o.setName('text').setDescription('The note').setMaxLength(1000).setRequired(false)))
    .addSubcommand((s) => s.setName('request-close').setDescription('(Staff) Ask the member if the ticket can be closed.').addStringOption((o) => o.setName('reason').setDescription('Why you think it is solved').setMaxLength(300).setRequired(false)))
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
    .addSubcommand((s) => s.setName('info').setDescription('Show info about this ticket.'))
    .addSubcommand((s) => s.setName('stats').setDescription('(Staff) The numbers of the tickets of this server: open, closed, ratings and who claims the most.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const lang = await languageOf(interaction);

    if (group === 'panel') return panelCmd(interaction, sub, lang);
    if (group === 'category') return categoryCmd(interaction, sub, lang);
    if (group === 'support-role') return roleListCmd(interaction, sub, 'support_role_ids', lang);
    if (group === 'ping-role') return roleListCmd(interaction, sub, 'ping_role_ids', lang);
    if (group === 'required-role') return roleListCmd(interaction, sub, 'required_role_ids', lang);
    if (group === 'form') return formCmd(interaction, sub, lang);
    if (group === 'blacklist') return blacklistCmd(interaction, sub, lang);

    if (sub === 'setup') return setupCmd(interaction, lang);
    if (sub === 'open') return openCmd(interaction, lang);
    if (sub === 'info') return infoCmd(interaction, lang);
    if (sub === 'stats') return statsCmd(interaction, lang);
    return ticketActionCmd(interaction, sub, lang);
  },
};

/** Replies with a permission error and returns false if the caller lacks Manage Server; true (no reply sent) otherwise. */
async function requireManageGuild(interaction, lang) {
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  await interaction.reply({ content: t(lang, 'tickets.needManageServer', { permission: t(lang, 'core.perm.ManageGuild') }), flags: MessageFlags.Ephemeral });
  return false;
}

async function setupCmd(interaction, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;
  const draft = startSetupDraft(interaction.user.id, { guildId: interaction.guild.id, channelId: interaction.channel?.isTextBased() ? interaction.channel.id : null, lang });
  await interaction.reply({ ...renderWizard(interaction.user.id, draft, lang), flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] });
}

async function panelCmd(interaction, sub, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const panels = await db.listPanels(interaction.guild.id);
    if (!panels.length) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.none'))], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const lines = await Promise.all(
      panels.map(async (p) => {
        const cats = await db.listCategories(interaction.guild.id, p.id);
        return tn(lang, 'tickets.panel.listLine', cats.length, { id: p.id, channel: p.channel_id, style: ['button', 'select'].includes(p.style) ? t(lang, `tickets.panel.style.${p.style}`) : p.style });
      }),
    );
    await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'delete') {
    const panelId = interaction.options.getInteger('panel_id', true);
    const panel = await db.getPanel(interaction.guild.id, panelId);
    if (!panel) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.notFound', { id: panelId }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    if (panel.message_id) {
      const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
      const msg = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
      await msg?.delete().catch(() => {});
    }
    await db.deletePanel(interaction.guild.id, panelId);
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.deleted', { emoji: EMOJI.APPROVE, id: panelId }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'resend') {
    const panelId = interaction.options.getInteger('panel_id', true);
    const panel = await db.getPanel(interaction.guild.id, panelId);
    if (!panel) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.notFound', { id: panelId }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const channel = await interaction.guild.channels.fetch(panel.channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.channelGone'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    if (panel.message_id) {
      let oldMessage = null;
      try {
        oldMessage = await channel.messages.fetch(panel.message_id);
      } catch (err) {
        // Discord 10008 means the old message is already gone; any other error is a real permission/API failure.
        if (err?.code !== 10008) {
          logger.error(`Failed to fetch panel #${panelId} before resend:`, err);
          await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.oldNoAccess'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
          return;
        }
      }
      if (oldMessage) {
        try {
          await oldMessage.delete();
        } catch (err) {
          logger.error(`Failed to delete panel #${panelId} before resend:`, err);
          await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.oldNoDelete'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
          return;
        }
      }
    }

    await db.updatePanel(interaction.guild.id, panelId, { message_id: null });
    const categories = await db.listCategories(interaction.guild.id, panel.id);
    const message = await channel.send(await renderPanelMessage(interaction.guild, panel, categories, channel, lang)).catch((err) => {
      logger.error(`Failed to resend panel #${panelId}:`, err);
      return null;
    });
    if (!message) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.resendFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    await db.setPanelMessageId(panel.id, message.id);
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.resent', { emoji: EMOJI.APPROVE, id: panelId, channel: `${channel}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'edit') return panelEdit(interaction, lang);

  // create
  const channel = interaction.options.getChannel('channel', true);
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const embedTemplate = interaction.options.getString('embed_template');
  const style = interaction.options.getString('style') ?? 'button';

  if (embedTemplate && !(await getTemplate(interaction.guild.id, embedTemplate))) {
    await interaction.editReply({
      components: [textCard(t(lang, 'tickets.panel.noEmbed', { emoji: EMOJI.ALERT, name: embedTemplate }), 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const look = readPanelLook(interaction, lang);
  if (look.error) {
    await interaction.editReply({ components: [textCard(`${EMOJI.ALERT}  ${look.error}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const panel = await db.createPanel({ guildId: interaction.guild.id, channelId: channel.id, title, description, embedTemplate, style, ...look.patch });

  const payload = await renderPanelMessage(interaction.guild, panel, [], channel, lang);
  const message = await channel.send(payload).catch((err) => {
    logger.error('Failed to post ticket panel:', err);
    return null;
  });

  if (!message) {
    await db.deletePanel(interaction.guild.id, panel.id);
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.postFailed', { emoji: EMOJI.DENY, channel: `${channel}` }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await db.setPanelMessageId(panel.id, message.id);
  await interaction.editReply({
    components: [textCard(t(lang, 'tickets.panel.posted', { emoji: EMOJI.APPROVE, id: panel.id, channel: `${channel}` }), 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

const NONE = /^(none|off|no|-)$/i;

/** The color, picture, footer and dropdown text a member typed for a panel: `{ patch }` with what was given, or `{ error }`. */
function readPanelLook(interaction, lang) {
  const patch = {};
  const color = interaction.options.getString('color');
  if (color !== null && color !== undefined) {
    if (NONE.test(color.trim())) patch.color = null;
    else {
      const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim());
      if (!hex) return { error: t(lang, 'tickets.panel.badColor') };
      patch.color = parseInt(hex[1], 16);
    }
  }
  const image = interaction.options.getString('image');
  if (image !== null && image !== undefined) {
    if (NONE.test(image.trim())) patch.image_url = null;
    else if (!/^https:\/\/\S+$/i.test(image.trim())) return { error: t(lang, 'tickets.panel.badImage') };
    else patch.image_url = image.trim().slice(0, 500);
  }
  const footer = interaction.options.getString('footer');
  if (footer !== null && footer !== undefined) patch.footer = NONE.test(footer.trim()) ? null : footer.trim().slice(0, 300);
  const placeholder = interaction.options.getString?.('placeholder');
  if (placeholder !== null && placeholder !== undefined) patch.placeholder = NONE.test(placeholder.trim()) ? null : placeholder.trim().slice(0, 150);
  return { patch };
}

/** `ticket panel edit`: changes the look of a panel and updates its message where it is. */
async function panelEdit(interaction, lang) {
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = await db.getPanel(interaction.guild.id, panelId);
  if (!panel) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.notFound', { id: panelId }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const look = readPanelLook(interaction, lang);
  if (look.error) {
    await interaction.editReply({ components: [textCard(`${EMOJI.ALERT}  ${look.error}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const patch = { ...look.patch };
  for (const key of ['title', 'description']) {
    const value = interaction.options.getString(key);
    if (value !== null && value !== undefined) patch[key] = NONE.test(value.trim()) ? null : value.trim().slice(0, key === 'title' ? 100 : 500);
  }
  const style = interaction.options.getString('style');
  if (style) patch.style = style;
  if (!Object.keys(patch).length) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.nothingToChange'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const updated = await db.updatePanel(interaction.guild.id, panelId, patch);
  const channel = await interaction.guild.channels.fetch(updated.channel_id).catch(() => null);
  const message = channel && updated.message_id ? await channel.messages.fetch(updated.message_id).catch(() => null) : null;
  if (message) {
    const categories = await db.listCategories(interaction.guild.id, updated.id);
    const payload = await renderPanelMessage(interaction.guild, updated, categories, channel, lang);
    await message.edit(payload).catch((err) => logger.warn(`Panel #${panelId} could not be edited: ${err.message}`));
  }
  await interaction.editReply({ components: [textCard(t(lang, message ? 'tickets.panel.changed' : 'tickets.panel.changedNotPosted', { emoji: EMOJI.APPROVE, id: panelId }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

/** Renders (or re-renders) a panel's message payload: embed-template-or-fallback + its categories' button/select row. */
async function renderPanelMessage(guild, panel, categories, channel, lang) {
  // The first panel and type the setup wizard writes are saved in the language of that moment: while they are still the English
  // defaults, they are shown in the server's language (what the staff wrote is shown as it is).
  panel = { ...panel, title: defaultText(lang, panel.title, 'tickets.setup.default.title'), description: defaultText(lang, panel.description, 'tickets.setup.default.description') };
  categories = categories.map((category) => ({ ...category, label: defaultText(lang, category.label, 'tickets.setup.default.typeLabel'), description: defaultText(lang, category.description, 'tickets.setup.default.typeDescription') }));
  const rows = buildPanelRows(panel.style, categories, { placeholder: panel.placeholder, lang });

  if (panel.embed_template) {
    const doc = await getTemplate(guild.id, panel.embed_template);
    if (doc) {
      const guildConfig = await ensureGuild(guild.id);
      const payload = await build(doc.data, { guild, channel, prefix: guildConfig.prefix });
      return { content: payload.content, embeds: payload.embeds, files: payload.files, components: [...(payload.components ?? []), ...rows] };
    }
  }

  return { components: [buildPanelFallbackCard({ title: panel.title, description: panel.description, color: panel.color, imageUrl: panel.image_url, footer: panel.footer, lang }), ...rows], flags: MessageFlags.IsComponentsV2 };
}

async function categoryCmd(interaction, sub, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (sub === 'list') {
    const categories = await db.listCategories(interaction.guild.id);
    if (!categories.length) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.none'))], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const lines = categories.map((c) => t(lang, 'tickets.category.listLine', { key: c.key, label: c.label, panel: c.panel_id ?? t(lang, 'tickets.none'), parent: c.parent_channel_id, count: c.support_role_ids.length }));
    await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'remove') {
    const key = interaction.options.getString('key', true);
    const removed = await db.deleteCategory(interaction.guild.id, key);
    await interaction.editReply({ components: [textCard(removed ? t(lang, 'tickets.category.removed', { emoji: EMOJI.APPROVE, key }) : t(lang, 'tickets.category.notFound', { key }), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    if (removed) await resyncPanelsForCategoryChange(interaction.guild, key, lang);
    return;
  }

  if (sub === 'edit') {
    const key = interaction.options.getString('key', true);
    const existing = await db.getCategoryByKey(interaction.guild.id, key);
    if (!existing) {
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.notFound', { key }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
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
    const formName = interaction.options.getString('form');
    const requiredRole = interaction.options.getRole('required_role');
    const naming = interaction.options.getString('naming');
    const welcome = interaction.options.getString('welcome');

    if (label) patch.label = label;
    if (parent) patch.parent_channel_id = parent.id;
    if (emoji) patch.emoji = emoji;
    if (style) patch.button_style = style;
    if (description) patch.description = description;
    if (welcomeEmbed) patch.welcome_embed_template = welcomeEmbed;
    if (maxOpen) patch.max_open_per_user = maxOpen;
    if (formName) {
      if (formName.toLowerCase() === 'none') patch.form_id = null;
      else {
        const form = await formsDb.getFormByName(interaction.guild.id, formName);
        if (!form) {
          await interaction.editReply({ components: [textCard(t(lang, 'tickets.form.notFound', { name: formName }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
          return;
        }
        patch.form_id = form.id;
      }
    }
    if (requiredRole) patch.required_role_ids = [...new Set([...(existing.required_role_ids ?? []), requiredRole.id])];
    if (naming) patch.naming_pattern = naming;
    if (welcome) patch.welcome_message = welcome.toLowerCase() === 'none' ? null : welcome;

    const updated = await db.updateCategory(interaction.guild.id, key, patch);
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.updated', { emoji: EMOJI.APPROVE, key: updated.key }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    if (label || emoji || style) await resyncPanelsForCategoryChange(interaction.guild, key, lang);
    return;
  }

  // add
  const panelId = interaction.options.getInteger('panel_id', true);
  const panel = await db.getPanel(interaction.guild.id, panelId);
  if (!panel) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.panel.notFound', { id: panelId }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // The same plan limit as the dashboard (db/premium.js ticketCategories).
  const allowed = await guildLimit(interaction.guild.id, 'ticketCategories');
  if ((await db.listCategories(interaction.guild.id)).length >= allowed.limit) {
    await interaction.editReply({ components: [textCard(t(lang, allowed.premium ? 'tickets.category.limit' : 'tickets.category.limitFree', { limit: allowed.limit, premium: allowed.premiumLimit }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const key = interaction.options.getString('key', true);
  if (await db.getCategoryByKey(interaction.guild.id, key)) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.exists', { key }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const welcomeEmbed = interaction.options.getString('welcome_embed');
  if (welcomeEmbed && !(await getTemplate(interaction.guild.id, welcomeEmbed))) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.noEmbed', { emoji: EMOJI.ALERT, name: welcomeEmbed }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const formName = interaction.options.getString('form');
  const form = formName ? await formsDb.getFormByName(interaction.guild.id, formName) : null;
  if (formName && !form) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.form.notFound', { name: formName }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const requiredRole = interaction.options.getRole('required_role');

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
    formId: form?.id,
    requiredRoleIds: requiredRole ? [requiredRole.id] : [],
    namingPattern: interaction.options.getString('naming'),
    welcomeMessage: interaction.options.getString('welcome'),
  });

  await resyncPanelsForCategoryChange(interaction.guild, category.key, lang);
  await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.added', { emoji: EMOJI.APPROVE, key: category.key, id: panelId }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

/** Re-renders a panel's live message after one of its categories changes, so the buttons/dropdown stay in sync. */
async function resyncPanelsForCategoryChange(guild, categoryKey, lang) {
  try {
    const category = await db.getCategoryByKey(guild.id, categoryKey);
    if (!category?.panel_id) return;
    const panel = await db.getPanel(guild.id, category.panel_id);
    if (!panel?.message_id) return;

    const channel = await guild.channels.fetch(panel.channel_id).catch(() => null);
    const message = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
    if (!message) return;

    const categories = await db.listCategories(guild.id, panel.id);
    const payload = await renderPanelMessage(guild, panel, categories, channel, lang);
    await message.edit(payload);
  } catch (err) {
    logger.warn('Failed to resync ticket panel message:', err.message);
  }
}

function parseFormFields(spec) {
  const fields = String(spec ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const [type, id, label, placeholder, required] = part.split('|').map((value) => value?.trim());
      return { type: type || 'short_text', id: id || `field_${index + 1}`, label, placeholder, required: required !== 'optional' && required !== 'false' };
    });
  return formsDb.normalizeFields(fields);
}

async function formCmd(interaction, sub, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;

  if ((sub === 'create' || sub === 'edit') && !interaction.options.getString('fields') && !(sub === 'edit' && interaction.options.getString('title'))) {
    const panelName = interaction.options.getString('name', true);
    const title = interaction.options.getString('title') ?? undefined;
    try {
      let draft;
      if (sub === 'edit') {
        const existing = await formsDb.getFormByName(interaction.guild.id, panelName);
        if (!existing) {
          await interaction.reply({ content: t(lang, 'tickets.form.notFound', { name: panelName }), flags: MessageFlags.Ephemeral });
          return;
        }
        draft = startDraft(interaction.user.id, { guildId: interaction.guild.id, mode: 'edit', name: existing.name, title: existing.title, fields: existing.fields ?? [] });
      } else {
        draft = startDraft(interaction.user.id, { guildId: interaction.guild.id, mode: 'create', name: panelName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'form', title, lang });
      }
      await interaction.reply({ ...renderFormPanel(interaction.user.id, draft, lang), flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] });
    } catch (err) {
      await interaction.reply({ content: err.message || t(lang, 'tickets.form.builderFailed'), flags: MessageFlags.Ephemeral });
    }
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  try {
    if (sub === 'list') {
      const forms = await formsDb.listForms(interaction.guild.id);
      const text = forms.length ? forms.map((form) => t(lang, 'tickets.form.listLine', { name: form.name, count: form.fields.length, title: form.title })).join('\n') : t(lang, 'tickets.form.none');
      await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const name = interaction.options.getString('name', true);
    if (sub === 'delete') {
      const deleted = await formsDb.deleteForm(interaction.guild.id, name);
      await interaction.editReply({ components: [textCard(deleted ? t(lang, 'tickets.form.deleted', { emoji: EMOJI.APPROVE, name }) : t(lang, 'tickets.form.notFound', { name }), deleted ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const fieldsSpec = interaction.options.getString('fields');
    const title = interaction.options.getString('title');
    if (sub === 'create') {
      const form = await formsDb.createForm({ guildId: interaction.guild.id, name, title, fields: parseFormFields(fieldsSpec) });
      await interaction.editReply({ components: [textCard(t(lang, 'tickets.form.created', { emoji: EMOJI.APPROVE, name: form.name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const patch = {};
    if (fieldsSpec) patch.fields = parseFormFields(fieldsSpec);
    if (title) patch.title = title;
    if (!Object.keys(patch).length) throw new Error(t(lang, 'tickets.form.nothingToChange'));
    const form = await formsDb.updateForm(interaction.guild.id, name, patch);
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.form.updated', { emoji: EMOJI.APPROVE, name: form.name }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.message || t(lang, 'tickets.form.updateFailed'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function blacklistCmd(interaction, sub, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  if (sub === 'list') {
    const entries = await accessDb.listBlacklist(interaction.guild.id);
    const text = entries.length
      ? entries.map((entry) => `${entry.target_type === 'user' ? `<@${entry.target_id}>` : `<@&${entry.target_id}>`}${entry.reason ? ` — ${entry.reason}` : ''}`).join('\n')
      : t(lang, 'tickets.blacklist.empty');
    await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  const target = user ? { type: 'user', id: user.id, mention: user.toString() } : role ? { type: 'role', id: role.id, mention: role.toString() } : null;
  if (!target) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.blacklist.chooseTarget'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const removed = sub === 'remove' ? await accessDb.removeBlacklist(interaction.guild.id, target.type, target.id) : false;
  if (sub === 'add') await accessDb.addBlacklist({ guildId: interaction.guild.id, targetType: target.type, targetId: target.id, reason: interaction.options.getString('reason') });
  await interaction.editReply({ components: [textCard(t(lang, sub === 'add' ? 'tickets.blacklist.added' : removed ? 'tickets.blacklist.removed' : 'tickets.blacklist.notIn', { emoji: EMOJI.APPROVE, target: target.mention }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function roleListCmd(interaction, sub, column, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const key = interaction.options.getString('key', true);
  const category = await db.getCategoryByKey(interaction.guild.id, key);
  if (!category) {
    await interaction.editReply({ components: [textCard(t(lang, 'tickets.category.notFound', { key }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (sub === 'list') {
    const ids = category[column] ?? [];
    const text = ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : t(lang, 'tickets.roles.none');
    await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const role = interaction.options.getRole('role', true);
  const ids = new Set(category[column] ?? []);
  if (sub === 'add') ids.add(role.id);
  else ids.delete(role.id);

  await db.updateCategory(interaction.guild.id, key, { [column]: [...ids] });
  await interaction.editReply({ components: [textCard(t(lang, sub === 'add' ? 'tickets.roles.added' : 'tickets.roles.removed', { emoji: EMOJI.APPROVE, role: `${role}`, key }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function openCmd(interaction, lang) {
  const key = interaction.options.getString('category', true);
  const category = await db.getCategoryByKey(interaction.guild.id, key);
  if (!category) {
    await interaction.reply({ content: t(lang, 'tickets.open.noCategory', { key }), flags: MessageFlags.Ephemeral });
    return;
  }

  await actions.openTicketInteractive(interaction, category, lang);
}

async function statsCmd(interaction, lang) {
  if (!(await requireManageGuild(interaction, lang))) return;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const [tickets, ratings] = await Promise.all([db.listTicketsForStats(interaction.guild.id), db.listRatingsForGuild(interaction.guild.id)]);
  const s = summarizeStats(tickets, ratings);
  // The counts are written as they always were (no thousands separators); only the average rating takes the decimal mark of the language.
  const lines = [
    t(lang, 'tickets.stats.title', { server: interaction.guild.name }),
    t(lang, 'tickets.stats.open', { open: s.open, unclaimed: s.unclaimed }),
    t(lang, 'tickets.stats.opened', { week: s.opened7, month: s.opened30 }),
    t(lang, 'tickets.stats.closed', { week: s.closed7, month: s.closed30 }),
    t(lang, 'tickets.stats.averageOpen', { duration: durationText(s.averageMinutesOpen, lang) }),
    s.averageRating === null ? t(lang, 'tickets.stats.noRatings') : t(lang, 'tickets.stats.rating', { rating: formatNumber(lang, s.averageRating), count: s.ratingCount }),
    s.topClaimers.length ? `${t(lang, 'tickets.stats.topClaimers')}\n${s.topClaimers.map((c, i) => `${i + 1}. <@${c.userId}> · ${c.count}`).join('\n')}` : '',
    s.total >= 5000 ? t(lang, 'tickets.stats.countedLatest', { count: s.total }) : tn(lang, 'tickets.stats.counted', s.total, { count: s.total }),
  ].filter(Boolean);
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function infoCmd(interaction, lang) {
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: t(lang, 'tickets.notTicketChannel'), flags: MessageFlags.Ephemeral });
    return;
  }

  const category = await db.getCategoryById(ticket.category_id);
  const priority = ticket.priority ?? 'normal';
  const lines = [
    t(lang, 'tickets.info.title', { number: ticket.ticket_number }),
    t(lang, 'tickets.info.category', { category: category?.label ?? t(lang, 'tickets.unknown') }),
    t(lang, 'tickets.info.openedBy', { user: ticket.opener_id }),
    t(lang, 'tickets.info.status', { status: ['open', 'closed'].includes(ticket.status) ? t(lang, `tickets.status.${ticket.status}`) : ticket.status }),
    t(lang, 'tickets.info.claimedBy', { user: ticket.claimed_by ? `<@${ticket.claimed_by}>` : t(lang, 'tickets.info.nobody') }),
    t(lang, 'tickets.info.priority', { mark: PRIORITY_MARK[priority], priority: priorityName(lang, priority) }),
    t(lang, 'tickets.info.opened', { time: `<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:R>` }),
  ];
  if (ticket.status === 'closed') {
    lines.push(t(lang, 'tickets.info.closedBy', { user: ticket.closed_by }), t(lang, 'tickets.info.closeReason', { reason: ticket.close_reason || t(lang, 'tickets.close.noReason') }));
  }

  await interaction.reply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

/** Shared entry point for close/reopen/delete/claim/unclaim/add/remove/rename/transcript — all operate on "the ticket in this channel". */
const PRIORITY_MARK = { low: '🟢', normal: '🔵', high: '🟠', urgent: '🔴' };
/** The name of a priority in `lang` (the value itself when it is not one Petto knows). */
const priorityName = (lang, level) => (Object.hasOwn(PRIORITY_MARK, level) ? t(lang, `tickets.priority.${level}`) : level);

async function ticketActionCmd(interaction, sub, lang) {
  const ticket = await db.getTicketByChannel(interaction.channel.id);
  if (!ticket) {
    await interaction.reply({ content: t(lang, 'tickets.notTicketChannel'), flags: MessageFlags.Ephemeral });
    return;
  }

  const category = await db.getCategoryById(ticket.category_id);
  const settings = await settingsDb.getSettings(interaction.guild.id);
  const isStaff = actions.isStaffForCategory(interaction.member, category ?? { support_role_ids: [] });
  const isStaffAllowed = actions.isStaffAllowedForTicket(interaction.member, category ?? { support_role_ids: [] }, ticket, settings);
  const isOpener = interaction.user.id === ticket.opener_id;

  const staffOnly = ['reopen', 'delete', 'claim', 'unclaim', 'rename', 'transcript', 'priority', 'transfer', 'note', 'request-close'];
  const openerOrStaff = ['close', 'add', 'remove'];

  if (staffOnly.includes(sub) && !isStaffAllowed) {
    if (isStaff && settings.claim_mode === 'exclusive' && ticket.claimed_by && ticket.claimed_by !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: t(lang, 'tickets.exclusiveClaim', { user: ticket.claimed_by }), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: t(lang, 'tickets.staffOnlyCategory'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (openerOrStaff.includes(sub) && !isStaff && !isOpener) {
    await interaction.reply({ content: t(lang, 'tickets.openerOrStaffOnly'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'close' && !isStaff) {
    const settings = await settingsDb.getSettings(interaction.guild.id);
    if (settings.close_requires_support_role) {
      await interaction.reply({ content: t(lang, 'tickets.staffOnlyClose'), flags: MessageFlags.Ephemeral });
      return;
    }
  }

  if (sub === 'close' && ticket.status === 'closed') {
    await interaction.reply({ content: t(lang, 'tickets.alreadyClosed'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (['priority', 'transfer', 'request-close'].includes(sub) && ticket.status === 'closed') {
    await interaction.reply({ content: t(lang, 'tickets.isClosed'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'reopen' && ticket.status !== 'closed') {
    await interaction.reply({ content: t(lang, 'tickets.notClosed'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = { guild: interaction.guild, client: interaction.client, channel: interaction.channel, ticket, actor: interaction.user };

  try {
    switch (sub) {
      case 'close': {
        const reason = interaction.options.getString('reason');
        await actions.closeTicket({ ...ctx, reason });
        await interaction.editReply({ content: t(lang, 'tickets.closed', { emoji: EMOJI.DENY }) });
        return;
      }
      case 'reopen':
        await actions.reopenTicket(ctx);
        await interaction.editReply({ content: t(lang, 'tickets.reopened', { emoji: EMOJI.TICKET_REOPEN }) });
        return;
      case 'delete':
        await interaction.editReply({ content: t(lang, 'tickets.deleting', { emoji: EMOJI.TICKET_DELETE }) });
        await actions.deleteTicketChannel(ctx);
        return;
      case 'claim':
        if (ticket.claimed_by) {
          await interaction.editReply({ content: t(lang, 'tickets.alreadyClaimed', { user: ticket.claimed_by }) });
          return;
        }
        await actions.claimTicket(ctx);
        await interaction.editReply({ content: t(lang, 'tickets.claim.youClaimed', { emoji: EMOJI.TICKET_CLAIM }) });
        return;
      case 'unclaim':
        await actions.unclaimTicket(ctx);
        await interaction.editReply({ content: t(lang, 'tickets.claim.released') });
        return;
      case 'add': {
        const targetUser = interaction.options.getUser('user', true);
        await actions.addMember({ ...ctx, targetUser });
        await interaction.editReply({ content: t(lang, 'tickets.member.added', { emoji: EMOJI.APPROVE, user: `${targetUser}` }) });
        return;
      }
      case 'remove': {
        const targetUser = interaction.options.getUser('user', true);
        await actions.removeMember({ ...ctx, targetUser });
        await interaction.editReply({ content: t(lang, 'tickets.member.removed', { emoji: EMOJI.APPROVE, user: `${targetUser}` }) });
        return;
      }
      case 'rename': {
        const newName = interaction.options.getString('name', true);
        const finalName = await actions.renameTicket({ ...ctx, newName });
        await interaction.editReply({ content: t(lang, 'tickets.renamed', { emoji: EMOJI.APPROVE, name: finalName }) });
        return;
      }
      case 'priority': {
        const level = interaction.options.getString('level', true);
        await db.setPriority(ticket.id, level);
        await interaction.channel.send({ content: t(lang, 'tickets.priority.set', { mark: PRIORITY_MARK[level], user: interaction.user.id, priority: priorityName(lang, level) }), allowedMentions: { parse: [] } }).catch(() => {});
        await interaction.editReply({ content: t(lang, 'tickets.priority.now', { emoji: EMOJI.APPROVE, priority: priorityName(lang, level) }) });
        return;
      }
      case 'transfer': {
        const target = interaction.options.getUser('user', true);
        const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!targetMember || target.bot || !actions.isStaffForCategory(targetMember, category ?? { support_role_ids: [] })) {
          await interaction.editReply({ content: t(lang, 'tickets.transfer.notStaff', { user: `${target}` }) });
          return;
        }
        await db.setClaim(ticket.id, target.id);
        await interaction.channel.send({ content: t(lang, 'tickets.transfer.notice', { emoji: EMOJI.TICKET_CLAIM, user: interaction.user.id, target: `${target}` }), allowedMentions: { users: [target.id] } }).catch(() => {});
        await interaction.editReply({ content: t(lang, 'tickets.transfer.done', { emoji: EMOJI.APPROVE, target: `${target}` }) });
        return;
      }
      case 'note': {
        const text = interaction.options.getString('text');
        if (text) {
          await db.addNote({ guildId: interaction.guild.id, ticketId: ticket.id, authorId: interaction.user.id, note: text });
          await interaction.editReply({ content: t(lang, 'tickets.note.saved', { emoji: EMOJI.APPROVE }) });
          return;
        }
        const notes = await db.listNotes(ticket.id);
        const body = notes.length ? notes.map((n) => `<t:${Math.floor(new Date(n.created_at).getTime() / 1000)}:R> <@${n.author_id}>: ${n.note}`).join('\n') : t(lang, 'tickets.note.none');
        await interaction.editReply({ content: body.slice(0, 1900), allowedMentions: { parse: [] } });
        return;
      }
      case 'request-close': {
        const reason = interaction.options.getString('reason');
        await interaction.channel.send({
          content: reason
            ? t(lang, 'tickets.requestClose.askReason', { opener: ticket.opener_id, user: `${interaction.user}`, reason })
            : t(lang, 'tickets.requestClose.ask', { opener: ticket.opener_id, user: `${interaction.user}` }),
          components: [buildCloseRequestRow(ticket.id, lang)],
          allowedMentions: { users: [ticket.opener_id] },
        });
        await interaction.editReply({ content: t(lang, 'tickets.requestClose.asked', { emoji: EMOJI.APPROVE, opener: ticket.opener_id }) });
        return;
      }
      case 'transcript': {
        const { link } = await actions.postTranscript(ctx);
        const linkRow = buildTranscriptLinkRow(link, lang);
        await interaction.editReply({ content: t(lang, 'tickets.transcript.posted', { emoji: EMOJI.APPROVE }), components: linkRow ? [linkRow] : [] });
        return;
      }
    }
  } catch (err) {
    if (err.userFacing) {
      await interaction.editReply({ content: err.message });
      return;
    }
    logger.error(`Ticket action "${sub}" failed:`, err);
    await interaction.editReply({ content: t(lang, 'tickets.actionFailed') });
  }
}

module.exports.renderPanelMessage = renderPanelMessage;
