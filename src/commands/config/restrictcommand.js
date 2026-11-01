// !restrictcommand: a command that only some roles can use. Administrators and the owner always can.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isHiddenWordFor } = require('../../utils/hiddenCommands');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/commandRestrictions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const RED = 0xfe6465;

/** The real name of a command written as a name, an alias or a shortcut, or null when Petto has no such command. */
function commandName(client, raw, userId = null) {
  const name = String(raw ?? '').trim().replace(/^[!/]/, '').toLowerCase();
  if (!name || isHiddenWordFor(client, name, userId)) return null; // a command hidden everywhere (`/music`) does not exist for the people outside the team
  if (client.commands.has(name)) return name;
  // A shortcut of one action of a command (`hug` of /act) is restricted on its own, under its own name.
  const route = client.commandRoutes?.get(name);
  return client.commandAliases?.get(name) ?? route?.disableName ?? route?.command ?? null;
}

module.exports = {
  aliases: ['restrictcmd', 'restrict', 'rc'],
  prefixDefaultSubcommand: 'add',
  prefixSubcommandAliases: { create: 'add', del: 'remove', delete: 'remove', clear: 'reset', view: 'list' },
  data: new SlashCommandBuilder()
    .setName('restrictcommand')
    .setDescription('Let only some roles use a command (administrators always can).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('add').setDescription('Only members with this role (or another role you add) can use the command.').addStringOption((o) => o.setName('command').setDescription('The command, as you type it without the prefix').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('The role that can use it').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Take a role off a command, or every role to open it again.').addStringOption((o) => o.setName('command').setDescription('The command').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('The role (empty: every role of the command)')))
    .addSubcommand((sub) => sub.setName('list').setDescription('See every restricted command and its roles.'))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Open every restricted command again.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const reply = (text, color = GREEN) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

    if (sub === 'list') {
      const map = await db.restrictionMap(interaction.guild.id);
      const names = Object.keys(map).sort();
      if (!names.length) return reply(t(lang, 'config.restrict.empty'), GREY);
      const lines = names.map((name) => `\`${name}\` · ${map[name].map((id) => `<@&${id}>`).join(' ')}`);
      return reply([tn(lang, 'config.restrict.title', names.length, { count: names.length }), ...lines].join('\n').slice(0, 3900), GREY);
    }

    if (sub === 'reset') {
      const removed = await db.clearRestrictions(interaction.guild.id);
      return reply(tn(lang, 'config.restrict.reset', removed, { emoji: EMOJI.APPROVE, count: removed }));
    }

    const raw = interaction.options.getString('command', true);
    const name = commandName(interaction.client, raw, interaction.user?.id);
    if (!name) return reply(t(lang, 'config.restrict.unknown', { emoji: EMOJI.DENY, command: raw.slice(0, 40) }), RED);
    const role = interaction.options.getRole('role', sub === 'add');

    if (sub === 'add') {
      if (role.id === interaction.guild.id) return reply(t(lang, 'config.restrict.everyone', { emoji: EMOJI.DENY }), RED);
      await db.addRestriction(interaction.guild.id, name, role.id, interaction.user.id);
      return reply(t(lang, 'config.restrict.added', { emoji: EMOJI.APPROVE, command: name, role: `${role}` }));
    }

    const removed = await db.removeRestriction(interaction.guild.id, name, role?.id ?? null);
    if (!removed) return reply(t(lang, 'config.restrict.notRestricted', { emoji: EMOJI.DENY, command: name }), GREY);
    const map = await db.restrictionMap(interaction.guild.id);
    return reply(map[name]?.length
      ? t(lang, 'config.restrict.removedRole', { emoji: EMOJI.APPROVE, command: name, role: `${role}` })
      : t(lang, 'config.restrict.open', { emoji: EMOJI.APPROVE, command: name }));
  },
  commandName,
};
