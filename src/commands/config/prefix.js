const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild, updateGuild } = require('../../db/guilds');
const { setCachedPrefix } = require('../../events/messageCreateCommands');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { readPrefixInput } = require('../../utils/prefixInput');
const guildPrefixes = require('../../utils/guildPrefixes');
const { t, languageOf } = require('../../i18n');

const listText = (list) => list.map((prefix) => `\`${prefix}\``).join(' · ');

module.exports = {
  aliases: ['pfx'],
  // `!prefix` shows the list; `!prefix ?` (a first word that is not a subcommand) is the old way of setting the only prefix.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'set' : 'show'),
  prefixSubcommandAliases: { list: 'show', delete: 'remove', del: 'remove', rm: 'remove', default: 'reset', defaults: 'reset' },
  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('View or change the command prefixes of the server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('show').setDescription('Show the prefixes of this server.'))
    .addSubcommand((s) => s.setName('add').setDescription('Add a prefix.')
      .addStringOption((o) => o.setName('prefix').setDescription('The new prefix, up to 12 characters, no spaces').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a prefix.')
      .addStringOption((o) => o.setName('prefix').setDescription('The prefix to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('set').setDescription('Make one prefix the only prefix.')
      .addStringOption((o) => o.setName('new_prefix').setDescription('The only prefix, up to 12 characters, no spaces').setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Go back to the default prefixes.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand(false) ?? 'show';
    const guildId = interaction.guild.id;
    const list = guildPrefixes.prefixesOf(await ensureGuild(guildId));
    const main = list[0];

    const card = (text, color) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    const refuse = (error) => interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    // The list is saved with its first prefix in the old column too, and the new list is used at once.
    const save = async (next) => {
      await updateGuild(guildId, guildPrefixes.columnsFor(next));
      setCachedPrefix(guildId, next);
    };
    const wordNote = (prefix) => (guildPrefixes.isWordPrefix(prefix) ? `\n${t(lang, 'core.prefix.wordNote', { prefix })}` : '');

    if (sub === 'show') {
      const text = `${t(lang, 'core.prefix.list', { list: listText(list), bot: `${interaction.client.user}` })}\n${t(lang, 'core.prefix.usage', { prefix: main, defaults: listText(guildPrefixes.DEFAULT_PREFIXES), max: guildPrefixes.MAX_PREFIXES, length: guildPrefixes.MAX_LENGTH })}`;
      return card(text);
    }

    if (sub === 'reset') {
      const next = [...guildPrefixes.DEFAULT_PREFIXES];
      await save(next);
      return card(t(lang, 'core.prefix.reset', { emoji: EMOJI.APPROVE, list: listText(next) }), 0xa5ea7a);
    }

    if (sub === 'add') {
      const added = guildPrefixes.addToList(list, interaction.options.getString('prefix', true), lang);
      if (added.error) return refuse(added.error);
      await save(added.prefixes);
      return card(`${t(lang, 'core.prefix.added', { emoji: EMOJI.APPROVE, prefix: added.prefix, list: listText(added.prefixes) })}${wordNote(added.prefix)}`, 0xa5ea7a);
    }

    if (sub === 'remove') {
      const removed = guildPrefixes.removeFromList(list, interaction.options.getString('prefix', true), lang);
      if (removed.error) return refuse(removed.error);
      await save(removed.prefixes);
      return card(t(lang, 'core.prefix.removed', { emoji: EMOJI.APPROVE, prefix: removed.prefix, list: listText(removed.prefixes) }), 0xa5ea7a);
    }

    // set: the old `!prefix ?`, the only prefix of the server.
    const checked = guildPrefixes.validatePrefix(readPrefixInput(interaction.options.getString('new_prefix', true)), lang);
    if (checked.error) return refuse(checked.error);
    await save([checked.prefix]);
    return card(`${t(lang, 'core.prefix.set', { emoji: EMOJI.APPROVE, prefix: checked.prefix })}${wordNote(checked.prefix)}`, 0xa5ea7a);
  },
};
