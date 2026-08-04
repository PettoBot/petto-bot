const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const ccDb = require('../../db/customCommands');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');

const MAX_PER_GUILD = 100;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('customcommand')
    .setDescription('Create your own commands that reply with a saved message.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Create a custom command.')
        .addStringOption((o) => o.setName('name').setDescription("The command's name (no prefix)").setRequired(true))
        .addStringOption((o) => o.setName('response').setDescription('What it replies with (supports variables, e.g. {user})').setRequired(true))
        .addStringOption((o) => o.setName('embed_template').setDescription('A saved /embed template to send instead of plain text').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit an existing custom command.')
        .addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true))
        .addStringOption((o) => o.setName('response').setDescription('New response text').setRequired(true))
        .addStringOption((o) => o.setName('embed_template').setDescription('A saved /embed template to send instead of plain text').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a custom command.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List every custom command.'))
    .addSubcommand((s) => s.setName('show').setDescription('Show a custom command without triggering it.').addStringOption((o) => o.setName('name').setDescription('Command name').setRequired(true))),
  aliases: ['cc'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction, false);
    if (sub === 'edit') return addCmd(interaction, true);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    return showCmd(interaction);
  },
};

async function addCmd(interaction, isEdit) {
  const name = ccDb.normalizeName(interaction.options.getString('name', true));
  const response = interaction.options.getString('response', true);
  const embedTemplate = interaction.options.getString('embed_template');

  if (interaction.client.commands.has(name) || interaction.client.commandAliases.has(name)) {
    await interaction.reply({ content: `\`${name}\` is already a real command — pick a different name.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (!isEdit) {
    const existing = await ccDb.getCommand(interaction.guild.id, name);
    if (existing) {
      await interaction.editReply({ components: [textCard(`\`${name}\` already exists — use \`customcommand edit\` instead.`, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const current = await ccDb.listCommands(interaction.guild.id);
    if (current.length >= MAX_PER_GUILD) {
      await interaction.editReply({ components: [textCard(`This server already has the maximum of ${MAX_PER_GUILD} custom commands.`, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  if (embedTemplate) {
    const template = await getTemplate(interaction.guild.id, embedTemplate);
    if (!template) {
      await interaction.editReply({ components: [textCard(`Embed template \`${embedTemplate}\` doesn't exist.`, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  await ccDb.upsertCommand(interaction.guild.id, name, { response, embedTemplate });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  \`${name}\` ${isEdit ? 'updated' : 'created'}. Try it with your prefix, e.g. \`!${name}\`.`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await ccDb.removeCommand(interaction.guild.id, name);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed.` : "That custom command doesn't exist.", removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await ccDb.listCommands(interaction.guild.id);
  const text = rows.length ? rows.map((r) => `\`${r.name}\``).join(', ') : 'No custom commands yet.';
  await interaction.editReply({ components: [textCard(`**Custom commands (${rows.length}/${MAX_PER_GUILD}):**\n${text}`, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}

async function showCmd(interaction) {
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const row = await ccDb.getCommand(interaction.guild.id, name);
  if (!row) {
    await interaction.editReply({ components: [textCard("That custom command doesn't exist.", COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const text = `**\`${row.name}\`**\n${row.embed_template ? `Embed template: \`${row.embed_template}\`` : ''}${row.response ? `\nResponse: ${row.response}` : ''}`;
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2 });
}
