const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const aliasesDb = require('../../db/commandAliases');
const { textCard } = require('../../utils/caseCard');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['aliases'],
  data: new SlashCommandBuilder()
    .setName('alias')
    .setDescription('Create shortcuts for prefix commands.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Add or replace an alias.').addStringOption((o) => o.setName('name').setDescription('Shortcut, without the prefix.').setRequired(true)).addStringOption((o) => o.setName('command').setDescription('Command to run, including its arguments.').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete one of your command aliases.').addStringOption((o) => o.setName('name').setDescription('Shortcut to remove.').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('Show what an alias runs.').addStringOption((o) => o.setName('name').setDescription('Shortcut to view.').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List this server’s aliases.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addAlias(interaction, lang);
    if (sub === 'remove') return removeAlias(interaction, lang);
    if (sub === 'view') return viewAlias(interaction, lang);
    const rows = await aliasesDb.list(interaction.guild.id);
    const body = rows.length ? rows.map((row) => `\`${row.name}\` → \`${row.command}\``).join('\n') : t(lang, 'config.alias.none');
    return interaction.reply({ components: [textCard(body)], flags: MessageFlags.IsComponentsV2 });
  },
};

async function addAlias(interaction, lang) {
  const name = aliasesDb.normalizeName(interaction.options.getString('name', true));
  const command = interaction.options.getString('command', true).trim();
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) return interaction.reply({ content: t(lang, 'config.alias.invalidName'), flags: MessageFlags.Ephemeral });
  if (!command || command.startsWith('alias ')) return interaction.reply({ content: t(lang, 'config.alias.invalidTarget'), flags: MessageFlags.Ephemeral });
  if (interaction.client.commands.has(name) || interaction.client.commandAliases.has(name) || (interaction.client.commandRoutes?.has(name) && !interaction.client.commandRoutes.get(name).short)) return interaction.reply({ content: t(lang, 'config.alias.taken'), flags: MessageFlags.Ephemeral });
  const row = await aliasesDb.add(interaction.guild.id, name, command);
  return interaction.reply({ components: [textCard(t(lang, 'config.alias.added', { name: row.name, command: row.command }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeAlias(interaction, lang) {
  const removed = await aliasesDb.remove(interaction.guild.id, interaction.options.getString('name', true));
  return interaction.reply({ components: [textCard(t(lang, removed ? 'config.alias.removed' : 'config.alias.missing'), removed ? 0xa5ea7a : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}

async function viewAlias(interaction, lang) {
  const row = await aliasesDb.get(interaction.guild.id, interaction.options.getString('name', true));
  return interaction.reply({ components: [textCard(row ? `\`${row.name}\` → \`${row.command}\`` : t(lang, 'config.alias.missing'), row ? 0x4b4f59 : 0xff6b6b)], flags: MessageFlags.IsComponentsV2 });
}
