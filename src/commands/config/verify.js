const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/verificationConfig');
const { getTemplate } = require('../../db/embedTemplates');
const { ensureUnverifiedRole } = require('../../utils/verifyRole');
const { createToken } = require('../../utils/verifyToken');
const { sendVerifyDM } = require('../../utils/verifyMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const config = require('../../config');
const logger = require('../../utils/logger');

const ENV_CONFIGURED = () => Boolean(config.verifyBaseUrl && config.turnstileSiteKey && config.turnstileSecretKey && config.verifyTokenSecret);

module.exports = {
  aliases: ['vf'],
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Configure the Cloudflare Turnstile join-verification gate.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Enable/disable verification and set the optional bonus role.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn verification on/off').setRequired(true))
        .addRoleOption((o) => o.setName('verified_role').setDescription('Optional role to grant once someone passes verification').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('template').setDescription('Use a saved embed for the DMs of verification, or none to go back to the usual one.')
      .addStringOption((o) => o.setName('which').setDescription('Which message').setRequired(true).addChoices({ name: 'prompt', value: 'prompt' }, { name: 'verified', value: 'verified' }))
      .addStringOption((o) => o.setName('template').setDescription('Saved embed name, or none').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current verification setup.'))
    .addSubcommand((s) => s.setName('send').setDescription('Manually (re)send a verification link to a member.').addUserOption((o) => o.setName('user').setDescription('The member to send a link to').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'template') return setTemplate(interaction);
    return send(interaction);
  },
};

async function setTemplate(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const which = interaction.options.getString('which', true);
  const name = interaction.options.getString('template', true).trim();
  const column = `${which}_embed_template`;
  const done = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
  if (name.toLowerCase() === 'none') {
    await upsertConfig(interaction.guild.id, { [column]: null });
    return done(`${EMOJI.APPROVE}  The ${which} DM goes back to the usual message.`);
  }
  const doc = await getTemplate(interaction.guild.id, name).catch(() => null);
  if (!doc) return done(`No saved embed named \`${name}\` was found. Make one in the dashboard, under Embeds.`, 0xfe6465);
  await upsertConfig(interaction.guild.id, { [column]: doc.name });
  return done(`${EMOJI.APPROVE}  The ${which} DM now uses \`${doc.name}\`.${which === 'prompt' ? ' Put `{verify.link}` where the link goes.' : ''}`);
}

async function setup(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const verifiedRole = interaction.options.getRole('verified_role');

  if (enabled && !interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'I need the **Manage Roles** permission to set up verification.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await ensureGuild(interaction.guild.id);
  const existing = (await getConfig(interaction.guild.id)) ?? {};

  const patch = { enabled };
  if (verifiedRole) patch.verified_role_id = verifiedRole.id;
  const saved = await upsertConfig(interaction.guild.id, patch);

  let roleLine = '';
  if (enabled) {
    try {
      const role = await ensureUnverifiedRole(interaction.guild, { ...existing, ...saved });
      roleLine = `\n**Gate role:** ${role} (denies View Channel everywhere; new members get it on join, lose it once verified)`;
    } catch (err) {
      logger.error('Failed to provision unverified role:', err);
      await interaction.editReply({ components: [textCard(`${EMOJI.DENY}  Enabled the config, but I was unable to set up the gate role: ${err.message}`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  const envLine = ENV_CONFIGURED() ? '' : `\n${EMOJI.ALERT}  \`VERIFY_BASE_URL\`/\`TURNSTILE_*\`/\`VERIFY_TOKEN_SECRET\` aren't fully set in \`.env\`. Links won't work until they are.`;

  const text = `${EMOJI.APPROVE}  Verification ${enabled ? 'enabled' : 'disabled'}.${roleLine}${verifiedRole ? `\n**Bonus role on success:** ${verifiedRole}` : ''}${envLine}`;
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const verifyConfig = await getConfig(interaction.guild.id);
  if (!verifyConfig) {
    await interaction.editReply({ components: [textCard('Verification has never been configured in this server. Use `!verify setup enabled:true`.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    `### Verification status`,
    `**Enabled:** ${verifyConfig.enabled ? `${EMOJI.APPROVE} Yes` : `${EMOJI.DENY} No`}`,
    `**Gate role:** ${verifyConfig.unverified_role_id ? `<@&${verifyConfig.unverified_role_id}>` : 'Not created yet'}`,
    `**Bonus role on success:** ${verifyConfig.verified_role_id ? `<@&${verifyConfig.verified_role_id}>` : 'None'}`,
    `**Web server env vars:** ${ENV_CONFIGURED() ? `${EMOJI.APPROVE} Configured` : `${EMOJI.DENY} Missing (links won't work)`}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function send(interaction) {
  const targetUser = interaction.options.getUser('user', true);

  if (!ENV_CONFIGURED()) {
    await interaction.reply({ content: 'Verification env vars are not fully set. See `!verify status`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: 'That user is not a member of this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await ensureGuild(interaction.guild.id);
  const verifyConfig = (await getConfig(interaction.guild.id)) ?? {};

  if (verifyConfig.enabled) {
    const role = await ensureUnverifiedRole(interaction.guild, verifyConfig);
    if (!targetMember.roles.cache.has(role.id)) {
      await targetMember.roles.add(role, 'Verification link resent').catch((err) => logger.warn('Could not add gate role:', err.message));
    }
  }

  const token = createToken({ userId: targetUser.id, guildId: interaction.guild.id });
  const link = `${config.verifyBaseUrl}/verify/${token}`;

  const dmSent = await sendVerifyDM(targetMember, { guild: interaction.guild, link })
    .then(() => true)
    .catch(() => false);

  const text = dmSent ? `${EMOJI.APPROVE}  Sent a verification link to ${targetUser}.` : `${EMOJI.DENY}  Could not DM ${targetUser} (DMs closed). Link: ${link}`;
  await interaction.editReply({ components: [textCard(text, dmSent ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}
