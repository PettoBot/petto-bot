const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const aliasesDb = require('../../db/commandAliases');
const { textCard } = require('../../utils/caseCard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alias')
    .setDescription('Create shortcuts for prefix commands.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Add or replace an alias.').addStringOption((o) => o.setName('name').setDescription('Shortcut, without the prefix.').setRequired(true)).addStringOption((o) => o.setName('command').setDescription('Command to run, including its arguments.').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove an alias.').addStringOption((o) => o.setName('name').setDescription('Shortcut to remove.').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('View one alias.').addStringOption((o) => o.setName('name').setDescription('Shortcut to view.').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server’s aliases.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addAlias(interaction);
    if (sub === 'remove') return removeAlias(interaction);
    if (sub === 'view') return viewAlias(interaction);
    const rows = await aliasesDb.list(interaction.guild.id);
    const body = rows.length ? rows.map((row) => `\`${row.name}\` → \`${row.command}\``).join('\n') : 'No aliases configured.';
    return interaction.reply({ components: [textCard(body, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
  },
};

async function addAlias(interaction) {
  const name = aliasesDb.normalizeName(interaction.options.getString('name', true));
  const command = interaction.options.getString('command', true).trim();
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) return interaction.reply({ content: 'Alias names may only contain letters, numbers, `_` and `-`.', flags: MessageFlags.Ephemeral });
  if (!command || command.startsWith('alias ')) return interaction.reply({ content: 'Provide a valid target command.', flags: MessageFlags.Ephemeral });
  if (interaction.client.commands.has(name) || interaction.client.commandAliases.has(name)) return interaction.reply({ content: 'That name is already used by a built-in command.', flags: MessageFlags.Ephemeral });
  const row = await aliasesDb.add(interaction.guild.id, name, command);
  return interaction.reply({ components: [textCard(`Alias \`${row.name}\` now runs \`${row.command}\`. Use placeholders such as \`{0}\` for arguments.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeAlias(interaction) {
  const removed = await aliasesDb.remove(interaction.guild.id, interaction.options.getString('name', true));
  return interaction.reply({ components: [textCard(removed ? 'Alias removed.' : 'That alias does not exist.', removed ? 0xa5ea7a : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}

async function viewAlias(interaction) {
  const row = await aliasesDb.get(interaction.guild.id, interaction.options.getString('name', true));
  return interaction.reply({ components: [textCard(row ? `\`${row.name}\` → \`${row.command}\`` : 'That alias does not exist.', row ? 0x8399ff : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}
