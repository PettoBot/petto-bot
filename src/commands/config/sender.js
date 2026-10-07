// Gives the messages Petto sends in some places their own name and picture: `!sender set quests Quest Hunter https://...png`.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { ensureGuild } = require('../../db/guilds');
const identities = require('../../db/senderIdentities');

const REPLY_FLAGS = MessageFlags.IsComponentsV2;
const LABELS = { quests: 'quest alerts', welcome: 'welcome messages', leave: 'leave messages', boost: 'boost messages', sanctions: 'sanction messages' };
const httpsUrl = (value) => { try { return new URL(String(value)).protocol === 'https:'; } catch { return false; } };

module.exports = {
  aliases: ['senderlook', 'webhookname'],
  data: new SlashCommandBuilder()
    .setName('sender')
    .setDescription('Give the messages Petto sends in some places their own name and picture.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('set').setDescription('Choose the name and the picture for a kind of message.')
      .addStringOption((o) => o.setName('feature').setDescription('Which messages').setRequired(true).addChoices(...identities.FEATURES.map((feature) => ({ name: LABELS[feature], value: feature }))))
      .addStringOption((o) => o.setName('name').setDescription('The name that is shown').setMaxLength(80).setRequired(false))
      .addStringOption((o) => o.setName('avatar').setDescription('A link (https) to the picture').setMaxLength(500).setRequired(false)))
    .addSubcommand((s) => s.setName('reset').setDescription('Go back to Petto\'s own name and picture.')
      .addStringOption((o) => o.setName('feature').setDescription('Which messages').setRequired(true).addChoices(...identities.FEATURES.map((feature) => ({ name: LABELS[feature], value: feature })))))
    .addSubcommand((s) => s.setName('list').setDescription('Show what is set.')),

  async execute(interaction) {
    await interaction.deferReply({ flags: REPLY_FLAGS });
    const reply = (text, color = null) => interaction.editReply({ components: [textCard(text, color)], flags: REPLY_FLAGS });
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return reply(`${EMOJI.DENY}  You need the Manage Server permission.`);
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await identities.list(guildId).catch(() => []);
      const lines = identities.FEATURES.map((feature) => {
        const row = rows.find((entry) => entry.feature === feature);
        return `**${LABELS[feature]}:** ${row ? `${row.name ? `\`${row.name}\`` : 'Petto\'s name'}${row.avatar_url ? `, [picture](${row.avatar_url})` : ', Petto\'s picture'}` : 'Petto'}`;
      });
      return reply(lines.join('\n'));
    }
    const feature = String(interaction.options.getString('feature', true)).toLowerCase();
    if (!identities.FEATURES.includes(feature)) return reply(`Choose one of: ${identities.FEATURES.map((entry) => `\`${entry}\``).join(', ')}.`);
    await ensureGuild(guildId);
    if (sub === 'reset') {
      await identities.remove(guildId, feature);
      return reply(`${EMOJI.APPROVE}  The ${LABELS[feature]} use Petto's name and picture again.`);
    }
    const name = String(interaction.options.getString('name') ?? '').trim();
    const avatar = String(interaction.options.getString('avatar') ?? '').trim();
    if (!name && !avatar) return reply('Give a name, a picture link, or both: `sender set quests Quest Hunter https://example.com/pic.png`.');
    if (avatar && !httpsUrl(avatar)) return reply('The picture has to be a link that starts with `https://`.');
    if (/discord/i.test(name) || /^clyde$/i.test(name)) return reply('Discord does not accept a webhook name with "discord" or "clyde" in it. Choose another name.');
    await identities.upsert(guildId, feature, { name: name || null, avatarUrl: avatar || null });
    return reply(`${EMOJI.APPROVE}  The ${LABELS[feature]} will be sent as ${name ? `\`${name}\`` : 'Petto'}${avatar ? ' with your picture' : ''}. Petto needs **Manage Webhooks** in the channel; without it the message is sent the normal way.`, 0xa5ea7a);
  },
};
