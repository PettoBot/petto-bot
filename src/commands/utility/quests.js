// Alerts for Discord Quests: a message in a channel when a new Quest appears, in a card the server can style or in one of
// its saved embeds. The data comes from api.discordquest.com, which allowed Petto's team to try it, so for now only the
// team and the testers can set it up when QUESTS_PUBLIC=false (see config.js); by default every server can.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const questsDb = require('../../db/quests');
const questApi = require('../../utils/questApi');
const { questMessage, buildQuestList, SECTIONS } = require('../../utils/questMessages');
const { canUseQuests } = require('../../utils/questAlerts');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** A list typed as `orbs, decoration` (or `all`) as the values it may hold, or null when one of them is not valid. */
function readList(text, allowed) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'none') return [];
  const values = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  return values.every((value) => allowed.includes(value)) ? values : null;
}

module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  aliases: ['quest', 'misiones'],
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Alerts when a new Discord Quest appears.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('enable').setDescription('Turn the alerts on in a channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Where the alerts go').addChannelTypes(...textChannels).setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('A role to ping with each alert').setRequired(false)))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn the alerts off.'))
    .addSubcommand((s) => s.setName('role').setDescription('Set the role pinged with each alert, or leave it empty for none.')
      .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(false)))
    .addSubcommand((s) => s.setName('style').setDescription('Use the card, or one of your saved embeds.')
      .addStringOption((o) => o.setName('style').setDescription('card or template').setRequired(true).addChoices({ name: 'card', value: 'card' }, { name: 'template', value: 'template' }))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, for the template style').setRequired(false)))
    .addSubcommand((s) => s.setName('rewards').setDescription('Only alert for some rewards: orbs, decoration, code, ingame, nitro. Empty for all.')
      .addStringOption((o) => o.setName('kinds').setDescription('For example: orbs, decoration').setRequired(false)))
    .addSubcommand((s) => s.setName('tasks').setDescription('Only alert for some tasks: video, play, stream, activity. Empty for all.')
      .addStringOption((o) => o.setName('kinds').setDescription('For example: video, play').setRequired(false)))
    .addSubcommand((s) => s.setName('card').setDescription('Choose what the card shows.')
      .addStringOption((o) => o.setName('action').setDescription('hide, show or reset').setRequired(true).addChoices({ name: 'hide', value: 'hide' }, { name: 'show', value: 'show' }, { name: 'reset', value: 'reset' }))
      .addStringOption((o) => o.setName('section').setDescription(`One of: ${SECTIONS.join(', ')}`).setRequired(false)))
    .addSubcommand((s) => s.setName('color').setDescription('Color of the card, as hex, or empty to use the color of each quest.')
      .addStringOption((o) => o.setName('hex').setDescription('For example #ff91c2').setRequired(false)))
    .addSubcommand((s) => s.setName('expiring').setDescription('Also alert when a quest is about to end, this many hours before. 0 turns it off.')
      .addIntegerOption((o) => o.setName('hours').setDescription('0 to 168').setMinValue(0).setMaxValue(168).setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the quests that are active now.')
      .addIntegerOption((o) => o.setName('page').setDescription('Page of the list').setMinValue(1).setRequired(false)))
    .addSubcommand((s) => s.setName('test').setDescription('Send the newest active quest here, to see how the alert looks.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the settings and the state of the quests API.')),

  async execute(interaction) {
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    if (!canUseQuests(interaction.user.id)) {
      return reply(`${EMOJI.DENY}  Quest alerts are in testing and only available to Petto's team for now.`);
    }
    await ensureGuild(interaction.guild.id);
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const current = (await questsDb.getConfig(guildId)) ?? questsDb.DEFAULTS;
    const save = (changes) => questsDb.upsertConfig(guildId, changes);

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('role');
      await save({ enabled: true, channel_id: channel.id, ...(role ? { role_id: role.id } : {}) });
      return reply(`${EMOJI.APPROVE}  Quest alerts will be sent in ${channel}${role ? ` with ${role}` : ''}. The first check only remembers the quests that exist now, so you will hear about the next new one. Use \`quests test\` to see how it looks.`);
    }
    if (sub === 'disable') {
      await save({ enabled: false });
      return reply(`${EMOJI.APPROVE}  Quest alerts are off.`);
    }
    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      await save({ role_id: role?.id ?? null });
      return reply(`${EMOJI.APPROVE}  ${role ? `Alerts will ping ${role}.` : 'Alerts will not ping a role.'}`);
    }
    if (sub === 'style') {
      const style = String(interaction.options.getString('style', true)).trim().toLowerCase();
      if (!['card', 'template'].includes(style)) return reply('Choose `card` or `template`.');
      if (style === 'card') {
        await save({ style: 'card' });
        return reply(`${EMOJI.APPROVE}  Alerts use the card.`);
      }
      const name = String(interaction.options.getString('template') ?? current.embed_template ?? '').trim();
      const doc = name ? await getTemplate(guildId, name).catch(() => null) : null;
      if (!doc) return reply(name ? `No saved embed named \`${name}\` was found. Make one in the dashboard, under Embeds. Its variables start with \`{quest.…}\`.` : 'Give the name of a saved embed: `quests style template <name>`.');
      await save({ style: 'template', embed_template: doc.name });
      return reply(`${EMOJI.APPROVE}  Alerts now use the saved embed \`${doc.name}\`. If it is missing or broken, the card is sent instead.`);
    }
    if (sub === 'rewards' || sub === 'tasks') {
      const allowed = sub === 'rewards' ? questApi.REWARD_KIND_LIST : questApi.TASK_KINDS;
      const values = readList(interaction.options.getString('kinds'), allowed);
      if (values === null) return reply(`Choose from: ${allowed.map((v) => `\`${v}\``).join(', ')}, or \`all\`.`);
      await save({ [sub === 'rewards' ? 'reward_kinds' : 'task_kinds']: values });
      return reply(`${EMOJI.APPROVE}  ${values.length ? `Only quests with ${sub === 'rewards' ? 'these rewards' : 'these tasks'}: ${values.join(', ')}.` : `Alerts for every kind of ${sub === 'rewards' ? 'reward' : 'task'}.`}`);
    }
    if (sub === 'card') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const section = String(interaction.options.getString('section') ?? '').trim().toLowerCase();
      if (action === 'reset') {
        await save({ hide_sections: [], accent_color: null });
        return reply(`${EMOJI.APPROVE}  The card shows everything again, with the color of each quest.`);
      }
      if (!['hide', 'show'].includes(action) || !SECTIONS.includes(section)) return reply(`Use \`quests card hide|show <section>\` with one of: ${SECTIONS.map((v) => `\`${v}\``).join(', ')}.`);
      const hidden = new Set(current.hide_sections);
      if (action === 'hide') hidden.add(section); else hidden.delete(section);
      await save({ hide_sections: [...hidden] });
      return reply(`${EMOJI.APPROVE}  The card ${action === 'hide' ? 'hides' : 'shows'} \`${section}\`.`);
    }
    if (sub === 'color') {
      const hex = String(interaction.options.getString('hex') ?? '').trim().replace(/^#/, '');
      if (!hex) { await save({ accent_color: null }); return reply(`${EMOJI.APPROVE}  The card uses the color of each quest.`); }
      if (!/^[0-9a-f]{6}$/i.test(hex)) return reply('Use a color like `#ff91c2`.');
      await save({ accent_color: parseInt(hex, 16) });
      return reply(`${EMOJI.APPROVE}  The card color is #${hex.toLowerCase()}.`);
    }
    if (sub === 'expiring') {
      const hours = interaction.options.getInteger('hours', true);
      await save({ expiring_hours: hours });
      return reply(`${EMOJI.APPROVE}  ${hours ? `Alerts also go out ${hours} hour${hours === 1 ? '' : 's'} before a quest ends.` : 'No alerts before a quest ends.'}`);
    }
    if (sub === 'list' || sub === 'test') {
      let quests;
      try { quests = (await questApi.fetchQuests({ force: true })).quests.filter((quest) => questApi.isActive(quest)); } catch (error) { return reply(`${EMOJI.DENY}  The quests could not be read: ${error.message}`); }
      quests.sort((a, b) => (b.startsAt - a.startsAt) || b.id.localeCompare(a.id));
      if (!quests.length) return reply('There are no active quests right now.');
      if (sub === 'list') return interaction.editReply(buildQuestList(quests, { page: interaction.options.getInteger('page') ?? 1 }));
      const payload = await questMessage(interaction.guild, { ...current, role_id: null }, quests[0], 'new');
      await interaction.channel.send(payload).catch(() => null);
      return reply(`${EMOJI.APPROVE}  Sent the newest quest here as a test.`);
    }
    const status = questApi.getStatus();
    const lines = [
      `**Alerts:** ${current.enabled && current.channel_id ? `on in <#${current.channel_id}>` : 'off'}`,
      `**Role:** ${current.role_id ? `<@&${current.role_id}>` : 'none'}`,
      `**Style:** ${current.style === 'template' && current.embed_template ? `saved embed \`${current.embed_template}\`` : 'card'}`,
      `**Rewards:** ${current.reward_kinds.length ? current.reward_kinds.join(', ') : 'all'} · **Tasks:** ${current.task_kinds.length ? current.task_kinds.join(', ') : 'all'}`,
      `**Card hides:** ${current.hide_sections.length ? current.hide_sections.join(', ') : 'nothing'}`,
      `**Before it ends:** ${current.expiring_hours ? `${current.expiring_hours} h` : 'off'}`,
      `**Quest sources:** ${status.ok === null ? 'not asked yet' : status.sources.filter((source) => source.ok !== null).map((source) => `${source.name} ${source.ok ? 'ok' : `failing (${source.error})`}`).join(', ')}${status.count ? `, ${status.count} quests` : ''}`,
    ];
    return reply(lines.join('\n'));
  },
};
