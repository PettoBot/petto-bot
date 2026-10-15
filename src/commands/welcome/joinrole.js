const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/joinRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['jr'],
  data: new SlashCommandBuilder()
    .setName('joinrole')
    .setDescription('Roles automatically given to new members on join.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Give a role automatically on join.')
        .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true))
        .addStringOption((o) => o.setName('target').setDescription('Who gets it (default: everyone)').setRequired(false).addChoices({ name: 'everyone', value: 'all' }, { name: 'humans only', value: 'humans' }, { name: 'bots only', value: 'bots' })),
    )
    .addSubcommand((s) => s.setName('remove').setDescription('Stop auto-giving a role on join.').addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List all configured join roles.'))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every configured join role.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    return clearCmd(interaction);
  },
};

function targetLabel(target, lang) {
  return t(lang, target === 'humans' ? 'welcome.joinRole.target.humans' : target === 'bots' ? 'welcome.joinRole.target.bots' : 'welcome.joinRole.target.all');
}

async function addCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const target = interaction.options.getString('target') ?? 'all';

  if (role.managed || role.id === interaction.guild.id) {
    await interaction.reply({ content: t(lang, 'welcome.joinRole.managed'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    await interaction.reply({ content: t(lang, 'welcome.joinRole.aboveMe'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.addRole(interaction.guild.id, role.id, target);

  await interaction.editReply({ components: [textCard(t(lang, 'welcome.joinRole.added', { emoji: EMOJI.APPROVE, role: `${role}`, target: targetLabel(target, lang) }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await db.removeRole(interaction.guild.id, role.id);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'welcome.joinRole.removed', { emoji: EMOJI.APPROVE, role: `${role}` }) : t(lang, 'welcome.joinRole.notConfigured', { role: `${role}` }), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const roles = await db.listRoles(interaction.guild.id);
  if (!roles.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'welcome.joinRole.empty'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = roles.map((r) => `<@&${r.role_id}> — ${targetLabel(r.target, lang)}`);
  await interaction.editReply({ components: [textCard(`${t(lang, 'welcome.joinRole.listTitle', { count: roles.length })}\n${lines.join('\n')}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function clearCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await db.clearRoles(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? tn(lang, 'welcome.joinRole.cleared', removed, { count: removed, emoji: EMOJI.APPROVE }) : t(lang, 'welcome.joinRole.nothingToClear'), removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
