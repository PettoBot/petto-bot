const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/joinRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

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

function targetLabel(target) {
  return target === 'humans' ? 'Humans only' : target === 'bots' ? 'Bots only' : 'Everyone';
}

async function addCmd(interaction) {
  const role = interaction.options.getRole('role', true);
  const target = interaction.options.getString('target') ?? 'all';

  if (role.managed || role.id === interaction.guild.id) {
    await interaction.reply({ content: "That role can't be assigned (managed by an integration, or @everyone).", flags: MessageFlags.Ephemeral });
    return;
  }
  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    await interaction.reply({ content: "That role is above my highest role, I can't assign it.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await db.addRole(interaction.guild.id, role.id, target);

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${role} will now be given automatically on join. **Target:** ${targetLabel(target)}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const role = interaction.options.getRole('role', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const removed = await db.removeRole(interaction.guild.id, role.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  ${role} is no longer given on join.` : `${role} isn't a configured join role.`, removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const roles = await db.listRoles(interaction.guild.id);
  if (!roles.length) {
    await interaction.editReply({ components: [textCard('No join roles configured. Use `!joinrole add` to set one up.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = roles.map((r) => `<@&${r.role_id}> — ${targetLabel(r.target)}`);
  await interaction.editReply({ components: [textCard(`**Join roles (${roles.length}):**\n${lines.join('\n')}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function clearCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await db.clearRoles(interaction.guild.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Removed all **${removed}** join role(s).` : 'No join roles to remove.', removed ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
