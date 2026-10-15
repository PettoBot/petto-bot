// Gives the messages Petto sends in some places their own name and picture: `!sender set quests Quest Hunter https://...png`.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { ensureGuild } = require('../../db/guilds');
const identities = require('../../db/senderIdentities');
const { t, languageOf } = require('../../i18n');

const REPLY_FLAGS = MessageFlags.IsComponentsV2;
// The names of the choices of the builder; the replies use config.sender.feature.<feature> in the language of the server.
const LABELS = { quests: 'quest alerts', welcome: 'welcome messages', leave: 'leave messages', boost: 'boost messages', sanctions: 'sanction messages', levelup: 'level-up messages', vanity: 'Vanity and Server Tag thank-yous', giveaways: 'giveaway messages', bump: 'bump thank-yous and reminders', tickets: 'ticket messages', automod: 'automod notices', partners: 'partner welcomes', votes: 'vote thank-yous', reminders: 'reminders', automessages: 'auto messages', rollouts: 'rollout alerts', birthdays: 'birthday messages' };
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
    .addSubcommand((s) => s.setName('list').setDescription('Show the names and pictures set for each kind of message.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: REPLY_FLAGS });
    const reply = (text, color = null) => interaction.editReply({ components: [textCard(text, color)], flags: REPLY_FLAGS });
    const label = (feature) => t(lang, `config.sender.feature.${feature}`);
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return reply(t(lang, 'config.sender.noPermission', { emoji: EMOJI.DENY }));
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const rows = await identities.list(guildId).catch(() => []);
      const lines = identities.FEATURES.map((feature) => {
        const row = rows.find((entry) => entry.feature === feature);
        const look = !row ? 'Petto'
          : t(lang, `config.sender.list.${row.name ? 'name' : 'pettoName'}.${row.avatar_url ? 'picture' : 'pettoPicture'}`, { name: row.name, url: row.avatar_url });
        return `**${label(feature)}:** ${look}`;
      });
      return reply(lines.join('\n'));
    }
    const feature = String(interaction.options.getString('feature', true)).toLowerCase();
    if (!identities.FEATURES.includes(feature)) return reply(t(lang, 'config.sender.chooseOne', { list: identities.FEATURES.map((entry) => `\`${entry}\``).join(', ') }));
    await ensureGuild(guildId);
    if (sub === 'reset') {
      await identities.remove(guildId, feature);
      return reply(t(lang, 'config.sender.reset', { emoji: EMOJI.APPROVE, feature: label(feature) }));
    }
    const name = String(interaction.options.getString('name') ?? '').trim();
    const avatar = String(interaction.options.getString('avatar') ?? '').trim();
    if (!name && !avatar) return reply(t(lang, 'config.sender.needLook'));
    if (avatar && !httpsUrl(avatar)) return reply(t(lang, 'config.sender.httpsOnly'));
    if (/discord/i.test(name) || /^clyde$/i.test(name)) return reply(t(lang, 'config.sender.badName'));
    await identities.upsert(guildId, feature, { name: name || null, avatarUrl: avatar || null });
    return reply(t(lang, avatar ? 'config.sender.savedWithPicture' : 'config.sender.saved', { emoji: EMOJI.APPROVE, feature: label(feature), name: name ? `\`${name}\`` : 'Petto' }), 0xa5ea7a);
  },
};
