// Quick replies for the staff of tickets: a text saved with a name (the questions that come up again and again) that is sent in a ticket
// with one command. `{user}`, `{username}`, `{category}`, `{server}` and `{number}` are filled in.
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const replies = require('../../db/ticketReplies');
const tickets = require('../../db/tickets');
const actions = require('../../utils/ticketActions');
const { renderWelcomeText } = require('../../utils/ticketCards');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const V2 = MessageFlags.IsComponentsV2;
const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });
const nameOption = (o) => o.setName('name').setDescription('The name of the quick reply (letters, numbers, - and _)').setMaxLength(30).setRequired(true);

module.exports = {
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
    const manager = interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if ((sub === 'add' || sub === 'remove') && !manager) return reply(interaction, `${EMOJI.DENY}  You need the **Manage Server** permission.`, RED, true);

    if (sub === 'list') {
      const rows = await replies.list(interaction.guild.id);
      if (!rows.length) return reply(interaction, 'There are no quick replies yet. Save one with `quickreply add <name> <text>`.', 0x4b4f59, true);
      return reply(interaction, rows.map((r) => `**${r.name}** · ${String(r.content).replace(/\s+/g, ' ').slice(0, 80)}`).join('\n'), 0x4b4f59, true);
    }

    const name = replies.normalizeName(interaction.options.getString('name', true));
    if (!replies.NAME.test(name)) return reply(interaction, `${EMOJI.DENY}  Use letters, numbers, - and _ (up to 30).`, RED, true);

    if (sub === 'add') {
      const existing = await replies.get(interaction.guild.id, name);
      if (!existing && (await replies.list(interaction.guild.id)).length >= replies.MAX_REPLIES) return reply(interaction, `${EMOJI.DENY}  You can keep up to ${replies.MAX_REPLIES} quick replies.`, RED, true);
      await replies.upsert(interaction.guild.id, name, interaction.options.getString('text', true), interaction.user.id);
      return reply(interaction, `${EMOJI.APPROVE}  Quick reply **${name}** ${existing ? 'changed' : 'saved'}. Send it in a ticket with \`quickreply send ${name}\`.`, GREEN, true);
    }

    if (sub === 'remove') {
      if (!(await replies.remove(interaction.guild.id, name))) return reply(interaction, `${EMOJI.DENY}  There is no quick reply called **${name}**.`, RED, true);
      return reply(interaction, `${EMOJI.APPROVE}  Quick reply **${name}** deleted.`, GREEN, true);
    }

    // send: only staff of the ticket, and only inside a ticket.
    const ticket = await tickets.getTicketByChannel(interaction.channel.id);
    if (!ticket || ticket.status !== 'open') return reply(interaction, `${EMOJI.DENY}  Use this inside an open ticket.`, RED, true);
    const category = await tickets.getCategoryById(ticket.category_id);
    if (!(await actions.isStaffAllowedForTicket(interaction.member, category, ticket))) return reply(interaction, `${EMOJI.DENY}  Only the staff of this ticket can send quick replies.`, RED, true);
    const row = await replies.get(interaction.guild.id, name);
    if (!row) return reply(interaction, `${EMOJI.DENY}  There is no quick reply called **${name}**. See them with \`quickreply list\`.`, RED, true);
    const opener = await interaction.client.users.fetch(ticket.opener_id).catch(() => null);
    const text = renderWelcomeText(row.content, { opener: opener ?? 'there', categoryLabel: category?.label, guildName: interaction.guild.name, ticketNumber: ticket.ticket_number });
    await interaction.channel.send({ components: [textCard(text, GREEN)], flags: V2, allowedMentions: { users: opener ? [opener.id] : [] } });
    return reply(interaction, `${EMOJI.APPROVE}  Sent.`, GREEN, true);
  },
};
