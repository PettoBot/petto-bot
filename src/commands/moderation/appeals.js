// Shows where members appeal a sanction of this server and whether appeals are open, and changes a few appeal settings (prefix only):
// which punishments can be appealed, whether sanction DMs carry the link, the server's own line in those DMs and the wait before appealing.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getConfig, countPendingAll, updateConfig } = require('../../db/appeals');
const { siteLink, PUNISHMENT_TYPES, DM_LINK_TYPES, LIMITS_EXTRA } = require('../../utils/appeals');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { t, tn, languageOf } = require('../../i18n');

const SETTINGS = ['types', 'dmlink', 'note', 'wait'];
// Words members are likely to type for a type of punishment.
const TYPE_ALIASES = { bans: 'ban', mutes: 'mute', timeout: 'mute', timeouts: 'mute', warns: 'warn', kicks: 'kick', softbans: 'softban' };
const DM_ALIASES = { bans: 'ban', tempbans: 'tempban', softbans: 'softban', kicks: 'kick', mute: 'timeout', mutes: 'timeout', timeouts: 'timeout', warns: 'warn' };
const listOf = (value, allowed, aliases) => {
  const words = String(value ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean).map((w) => aliases[w] ?? w);
  return words.every((w) => allowed.includes(w)) ? [...new Set(words)] : null;
};
const OFF = ['off', 'none', 'clear', 'reset', '0'];

/** The settings as the staff read them. */
function summary(config, lang) {
  const mode = config.dm_link_mode ?? 'always';
  const dm = mode === 'types' ? (config.dm_link_types ?? []).join(', ') || t(lang, 'moderation.appeals.settings.nothing') : t(lang, `moderation.appeals.settings.dm.${mode === 'never' ? 'never' : 'always'}`);
  return t(lang, 'moderation.appeals.settings.list', {
    types: (config.punishment_types ?? []).join(', ') || t(lang, 'moderation.appeals.settings.nothing'),
    dm,
    note: config.dm_note ? `“${config.dm_note}”` : t(lang, 'moderation.appeals.settings.noNote'),
    wait: config.min_wait_hours ? tn(lang, 'moderation.appeals.settings.hours', config.min_wait_hours) : t(lang, 'moderation.appeals.settings.noWait'),
  });
}

module.exports = {
  aliases: ['appeal'],
  data: new SlashCommandBuilder()
    .setName('appeals')
    .setDescription('See the appeal page of this server and how many appeals wait for an answer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('setting').setDescription('A setting to change: types, dmlink, note or wait').setRequired(false))
    .addStringOption((o) => o.setName('value').setDescription('The new value of the setting').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const reply = (text, color) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
    const guildId = interaction.guild.id;
    const setting = String(interaction.options.getString('setting') ?? '').trim().toLowerCase();
    const value = String(interaction.options.getString('value') ?? '').trim();

    if (setting && setting !== 'settings') {
      if (!SETTINGS.includes(setting)) return reply(t(lang, 'moderation.appeals.settings.usage'), 0xfe6465);
      const config = await getConfig(guildId);
      if (!value) return reply(`${t(lang, `moderation.appeals.settings.help.${setting}`)}\n\n${summary(config, lang)}`);
      let patch = null;
      if (setting === 'types') {
        const types = OFF.includes(value.toLowerCase()) ? [] : listOf(value, PUNISHMENT_TYPES, TYPE_ALIASES);
        if (!types) return reply(t(lang, 'moderation.appeals.settings.badTypes', { list: PUNISHMENT_TYPES.join(', ') }), 0xfe6465);
        patch = { punishment_types: types };
      } else if (setting === 'dmlink') {
        const word = value.toLowerCase();
        if (word === 'always' || word === 'never') patch = { dm_link_mode: word };
        else {
          const types = listOf(value, DM_LINK_TYPES, DM_ALIASES);
          if (!types?.length) return reply(t(lang, 'moderation.appeals.settings.badDm', { list: DM_LINK_TYPES.join(', ') }), 0xfe6465);
          patch = { dm_link_mode: 'types', dm_link_types: types };
        }
      } else if (setting === 'note') {
        if (value.length > LIMITS_EXTRA.dmNote) return reply(t(lang, 'moderation.appeals.settings.noteLong', { max: LIMITS_EXTRA.dmNote }), 0xfe6465);
        patch = { dm_note: OFF.includes(value.toLowerCase()) ? null : value };
      } else {
        const hours = OFF.includes(value.toLowerCase()) ? 0 : Number(value.replace(/h$/i, ''));
        if (!Number.isInteger(hours) || hours < 0 || hours > LIMITS_EXTRA.minWaitHours) return reply(t(lang, 'moderation.appeals.settings.badWait', { max: LIMITS_EXTRA.minWaitHours }), 0xfe6465);
        patch = { min_wait_hours: hours };
      }
      await ensureGuild(guildId);
      await updateConfig(guildId, patch);
      return reply(`${t(lang, 'moderation.appeals.settings.saved')}\n\n${summary({ ...config, ...patch }, lang)}`, 0xa5ea7a);
    }

    const config = await getConfig(guildId);
    const link = siteLink(guildId, config.slug);
    if (!config.enabled) {
      return reply(`${t(lang, 'moderation.appeals.off', { link })}\n\n${summary(config, lang)}`);
    }
    let pending = 0;
    try { pending = await countPendingAll(guildId); } catch { /* The count is a bonus. */ }
    return reply(`${t(lang, 'moderation.appeals.on', { link, count: pending })}\n\n${summary(config, lang)}`, 0xf0a88f);
  },
};
