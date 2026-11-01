// Quick replies for the staff of tickets: a text saved with a name (the questions that come up again and again) that is sent in a ticket
// with one command. `{user}`, `{username}`, `{category}`, `{server}` and `{number}` are filled in.
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const replies = require('../../db/ticketReplies');
const tickets = require('../../db/tickets');
const actions = require('../../utils/ticketActions');
const { renderWelcomeText } = require('../../utils/ticketCards');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const nameOption = (o) => o.setName('name').setDescription('The name of the quick reply (letters, numbers, - and _)').setMaxLength(30).setRequired(true);

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['qr', 'macro'],
  data: new SlashCommandBuilder()
    .setName('quickreply')
    .setDescription('(Staff) Quick replies for tickets: save a text with a name and send it in a ticket.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('send').setDescription('Send a quick reply in this ticket.').addStringOption(nameOption))
    .addSubcommand((s) => s.setName('add').setDescription('Save a quick reply (or change one). You need Manage Server.').addStringOption(nameOption).addStringOption((o) => o.setName('text').setDescription('The text. You can use {user}, {username}, {category}, {server} and {number}').setMaxLength(1500).setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a quick reply. You need Manage Server.').addStringOption(nameOption))
    .addSubcommand((s) => s.setName('list').setDescription('The quick replies of this server.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if ((sub === 'add' || sub === 'remove') && !manager) return reply(interaction, t(lang, 'tickets.quickreply.needManageServer', { emoji: EMOJI.DENY, permission: t(lang, 'core.perm.ManageGuild') }), RED, true);

    if (sub === 'list') {
      const rows = await replies.list(interaction.guild.id);
      if (!rows.length) return reply(interaction, t(lang, 'tickets.quickreply.none'), 0x4b4f59, true);
      return reply(interaction, rows.map((r) => `**${r.name}** · ${String(r.content).replace(/\s+/g, ' ').slice(0, 80)}`).join('\n'), 0x4b4f59, true);
    }

    const name = replies.normalizeName(interaction.options.getString('name', true));
    if (!replies.NAME.test(name)) return reply(interaction, t(lang, 'tickets.quickreply.badName', { emoji: EMOJI.DENY }), RED, true);

    if (sub === 'add') {
      const existing = await replies.get(interaction.guild.id, name);
      if (!existing && (await replies.list(interaction.guild.id)).length >= replies.MAX_REPLIES) return reply(interaction, t(lang, 'tickets.quickreply.full', { emoji: EMOJI.DENY, max: replies.MAX_REPLIES }), RED, true);
      await replies.upsert(interaction.guild.id, name, interaction.options.getString('text', true), interaction.user.id);
      return reply(interaction, t(lang, existing ? 'tickets.quickreply.changed' : 'tickets.quickreply.saved', { emoji: EMOJI.APPROVE, name }), GREEN, true);
    }

    if (sub === 'remove') {
      if (!(await replies.remove(interaction.guild.id, name))) return reply(interaction, t(lang, 'tickets.quickreply.notFound', { emoji: EMOJI.DENY, name }), RED, true);
      return reply(interaction, t(lang, 'tickets.quickreply.deleted', { emoji: EMOJI.APPROVE, name }), GREEN, true);
    }

    // send: only staff of the ticket, and only inside a ticket.
    const ticket = await tickets.getTicketByChannel(interaction.channel.id);
    if (!ticket || ticket.status !== 'open') return reply(interaction, t(lang, 'tickets.quickreply.openTicketOnly', { emoji: EMOJI.DENY }), RED, true);
    const category = await tickets.getCategoryById(ticket.category_id);
    if (!(await actions.isStaffAllowedForTicket(interaction.member, category, ticket))) return reply(interaction, t(lang, 'tickets.quickreply.staffOnly', { emoji: EMOJI.DENY }), RED, true);
    const row = await replies.get(interaction.guild.id, name);
    if (!row) return reply(interaction, t(lang, 'tickets.quickreply.notFoundList', { emoji: EMOJI.DENY, name }), RED, true);
    const opener = await interaction.client.users.fetch(ticket.opener_id).catch(() => null);
    const text = renderWelcomeText(row.content, { opener: opener ?? t(lang, 'tickets.quickreply.openerFallback'), categoryLabel: category?.label, guildName: interaction.guild.name, ticketNumber: ticket.ticket_number });
    await interaction.channel.send({ components: [textCard(text, GREEN)], flags: V2, allowedMentions: { users: opener ? [opener.id] : [] } });
    return reply(interaction, t(lang, 'tickets.quickreply.sent', { emoji: EMOJI.APPROVE }), GREEN, true);
  },
};
