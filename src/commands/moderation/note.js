const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { addNote, getNote, getNotesForUser } = require('../../db/notes');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['notes'],
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Staff notes on a user (non-punitive, not part of their case history).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a note to a user.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to note').setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('The note content').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('view').setDescription('View a note by its ID.').addIntegerOption((opt) => opt.setName('id').setDescription('Note ID').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show all notes on a user.').addUserOption((opt) => opt.setName('user').setDescription('The user to check').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return add(interaction);
    if (sub === 'view') return view(interaction);
    return list(interaction);
  },
};

async function add(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  const note = interaction.options.getString('note', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const saved = await addNote({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, note });

  const text = [`${EMOJI.APPROVE}  Note #${saved.id} added for ${targetUser}.`, `**Moderator:** ${interaction.user}`, `**Note:** ${note}`].join('\n');
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function view(interaction) {
  const noteId = interaction.options.getInteger('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const note = await getNote(interaction.guild.id, noteId);
  if (!note) {
    await interaction.editReply({ components: [textCard(`No note #${noteId} found in this server.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const ts = Math.floor(new Date(note.created_at).getTime() / 1000);
  const text = [
    `### ${EMOJI.QUESTION} Note #${note.id}`,
    `**User:** <@${note.user_id}>`,
    `**Moderator:** <@${note.moderator_id}>`,
    `**When:** <t:${ts}:F> (<t:${ts}:R>)`,
    `**Note:** ${note.note}`,
  ].join('\n');
  await interaction.editReply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function list(interaction) {
  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const notes = await getNotesForUser(interaction.guild.id, targetUser.id);
  if (!notes.length) {
    await interaction.editReply({ components: [textCard(`No notes on record for ${targetUser}.`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [`### Notes for ${targetUser}`];
  for (const note of notes) {
    const ts = Math.floor(new Date(note.created_at).getTime() / 1000);
    lines.push(`\`#${note.id}\` <@${note.moderator_id}> · <t:${ts}:R>\n> ${note.note}`);
  }

  await interaction.editReply({ components: [textCard(lines.join('\n\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
