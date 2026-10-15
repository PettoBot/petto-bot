// Alerts for Discord Quests: a message in a channel when a new Quest appears, in a card the server can style or in one of
// its saved embeds. The data comes from api.discordquest.com, which allowed Petto's team to try it, so for now only the
// team and the testers can set it up when QUESTS_PUBLIC=false (see config.js); by default every server can.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const questsDb = require('../../db/quests');
const questApi = require('../../utils/questApi');
const { questMessage, buildQuestList, SECTIONS } = require('../../utils/questMessages');
const { canUseQuests, resendMissing } = require('../../utils/questAlerts');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { actionAndText } = require('../../utils/codeArgs');
const { ARCHIVE_MINUTES, DEFAULT_THREAD_NAME, TEXT_LIMIT, sendMethodNow } = require('../../utils/questMethod');
const { t, tn, languageOf } = require('../../i18n');
const { sourceProblem } = require('../../utils/sourceProblems');

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
  prefixRawOptions: { thread: actionAndText, method: actionAndText },
  data: new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Alerts when a new Discord Quest appears.')
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
      // i18n-ignore: builder description (translated in the cmd catalogs)
      .addStringOption((o) => o.setName('section').setDescription(`One of: ${SECTIONS.join(', ')}`).setRequired(false)))
    .addSubcommand((s) => s.setName('color').setDescription('Color of the card, as hex, or empty to use the color of each quest.')
      .addStringOption((o) => o.setName('hex').setDescription('For example #ff91c2').setRequired(false)))
    .addSubcommand((s) => s.setName('expiring').setDescription('Also alert when a quest is about to end, this many hours before. 0 turns it off.')
      .addIntegerOption((o) => o.setName('hours').setDescription('0 to 168').setMinValue(0).setMaxValue(168).setRequired(true)))
    .addSubcommand((s) => s.setName('type').setDescription('A different saved embed for each kind of reward (orbs, decoration, code, ingame, nitro).')
      .addStringOption((o) => o.setName('kind').setDescription('The kind of reward').setRequired(true).addChoices(...questApi.REWARD_KIND_LIST.map((kind) => ({ name: kind, value: kind }))))
      .addStringOption((o) => o.setName('target').setDescription('alert or method').setRequired(true).addChoices({ name: 'alert', value: 'alert' }, { name: 'method', value: 'method' }))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, or empty to remove it').setRequired(false)))
    .addSubcommand((s) => s.setName('thread').setDescription('Open a thread under each alert, to talk about that quest.')
      .addStringOption((o) => o.setName('action').setDescription('on, off, ping, noping, name or archive').setRequired(true).addChoices(
        { name: 'on', value: 'on' }, { name: 'off', value: 'off' }, { name: 'ping (add the role to the thread)', value: 'ping' }, { name: 'noping', value: 'noping' }, { name: 'name', value: 'name' }, { name: 'archive (minutes)', value: 'archive' }))
      .addStringOption((o) => o.setName('value').setDescription('For name: the title, with {quest.name}. For archive: 60, 1440, 4320 or 10080').setRequired(false)))
    .addSubcommand((s) => s.setName('method').setDescription('The message that tells how to complete quests, sent in the thread or in a channel.')
      .addStringOption((o) => o.setName('action').setDescription('on, off, send, text, template, thread, channel, ping, noping or show').setRequired(true).addChoices(
        { name: 'on', value: 'on' }, { name: 'off', value: 'off' }, { name: 'send (now)', value: 'send' }, { name: 'text', value: 'text' }, { name: 'template (a saved embed)', value: 'template' },
        { name: 'thread (send it in the thread)', value: 'thread' }, { name: 'channel', value: 'channel' }, { name: 'ping', value: 'ping' }, { name: 'noping', value: 'noping' }, { name: 'show', value: 'show' }))
      .addStringOption((o) => o.setName('value').setDescription('The text, the name of a saved embed, a channel, or the id of a quest for send').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the quests that are active now.')
      .addIntegerOption((o) => o.setName('page').setDescription('Page of the list').setMinValue(1).setRequired(false)))
    .addSubcommand((s) => s.setName('resend').setDescription('Send the active quests that were not posted here yet, up to 10 at a time.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send the newest active quest here, to see how the alert looks.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the settings and the state of the quests API.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    const done = (key, vars) => reply(`${EMOJI.APPROVE}  ${t(lang, key, vars)}`);
    const code = (values) => values.map((v) => `\`${v}\``).join(', ');
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    if (!canUseQuests(interaction.user.id)) {
      return reply(`${EMOJI.DENY}  ${t(lang, 'quests.testing')}`);
    }
    const sub = interaction.options.getSubcommand();
    // Anyone can see the quests that are active; the settings and the test are for who manages the server.
    if (sub !== 'list' && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply(`${EMOJI.DENY}  ${t(lang, 'quests.command.needsManageServer')}`);
    }
    await ensureGuild(interaction.guild.id);
    const guildId = interaction.guild.id;
    const current = (await questsDb.getConfig(guildId)) ?? questsDb.DEFAULTS;
    const save = (changes) => questsDb.upsertConfig(guildId, changes);

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('role');
      await save({ enabled: true, channel_id: channel.id, ...(role ? { role_id: role.id } : {}) });
      return done(role ? 'quests.command.enabledRole' : 'quests.command.enabled', { channel: `${channel}`, role: `${role}` });
    }
    if (sub === 'disable') {
      await save({ enabled: false });
      return done('quests.command.disabled');
    }
    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      await save({ role_id: role?.id ?? null });
      return done(role ? 'quests.command.role' : 'quests.command.noRole', { role: `${role}` });
    }
    if (sub === 'style') {
      const style = String(interaction.options.getString('style', true)).trim().toLowerCase();
      if (!['card', 'template'].includes(style)) return reply(t(lang, 'quests.style.choose'));
      if (style === 'card') {
        await save({ style: 'card' });
        return done('quests.style.card');
      }
      const name = String(interaction.options.getString('template') ?? current.embed_template ?? '').trim();
      const doc = name ? await getTemplate(guildId, name).catch(() => null) : null;
      if (!doc) return reply(name ? t(lang, 'quests.style.notFound', { name }) : t(lang, 'quests.style.giveName'));
      await save({ style: 'template', embed_template: doc.name });
      return done('quests.style.template', { name: doc.name });
    }
    if (sub === 'rewards' || sub === 'tasks') {
      const allowed = sub === 'rewards' ? questApi.REWARD_KIND_LIST : questApi.TASK_KINDS;
      const values = readList(interaction.options.getString('kinds'), allowed);
      if (values === null) return reply(t(lang, 'quests.filter.choose', { values: code(allowed) }));
      await save({ [sub === 'rewards' ? 'reward_kinds' : 'task_kinds']: values });
      return done(values.length ? `quests.filter.${sub}Only` : `quests.filter.${sub}All`, { values: values.join(', ') });
    }
    if (sub === 'card') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const section = String(interaction.options.getString('section') ?? '').trim().toLowerCase();
      if (action === 'reset') {
        await save({ hide_sections: [], accent_color: null });
        return done('quests.cardSettings.reset');
      }
      if (!['hide', 'show'].includes(action) || !SECTIONS.includes(section)) return reply(t(lang, 'quests.cardSettings.usage', { sections: code(SECTIONS) }));
      const hidden = new Set(current.hide_sections);
      if (action === 'hide') hidden.add(section); else hidden.delete(section);
      await save({ hide_sections: [...hidden] });
      return done(action === 'hide' ? 'quests.cardSettings.hides' : 'quests.cardSettings.shows', { section });
    }
    if (sub === 'color') {
      const hex = String(interaction.options.getString('hex') ?? '').trim().replace(/^#/, '');
      if (!hex) { await save({ accent_color: null }); return done('quests.color.each'); }
      if (!/^[0-9a-f]{6}$/i.test(hex)) return reply(t(lang, 'quests.color.invalid'));
      await save({ accent_color: parseInt(hex, 16) });
      return done('quests.color.set', { hex: hex.toLowerCase() });
    }
    if (sub === 'expiring') {
      const hours = interaction.options.getInteger('hours', true);
      await save({ expiring_hours: hours });
      return reply(`${EMOJI.APPROVE}  ${hours ? tn(lang, 'quests.expiring.on', hours, { count: hours }) : t(lang, 'quests.expiring.off')}`);
    }
    if (sub === 'resend') {
      if (!current.enabled || !current.channel_id) return reply(`${EMOJI.DENY}  ${t(lang, 'quests.resend.notEnabled')}`);
      let result;
      try { result = await resendMissing(interaction.client, { ...current, guild_id: guildId }); } catch (error) { return reply(`${EMOJI.DENY}  ${t(lang, 'quests.readFailed', { error: sourceProblem(error.message, lang) })}`); }
      if (!result.missing) return done('quests.resend.nothing');
      const parts = [tn(lang, 'quests.resend.sent', result.missing, { sent: result.sent, count: result.missing, channel: `<#${current.channel_id}>` })];
      if (result.left) parts.push(t(lang, 'quests.resend.left', { count: result.left }));
      if (result.sent < Math.min(result.missing, 10)) parts.push(t(lang, 'quests.resend.someFailed'));
      return reply(`${result.sent ? EMOJI.APPROVE : EMOJI.DENY}  ${parts.join(' ')}`);
    }
    if (sub === 'type') {
      const kind = String(interaction.options.getString('kind', true)).trim().toLowerCase();
      const target = String(interaction.options.getString('target', true)).trim().toLowerCase();
      const name = String(interaction.options.getString('template') ?? '').trim();
      if (!questApi.REWARD_KIND_LIST.includes(kind) || !['alert', 'method'].includes(target)) return reply(t(lang, 'quests.type.usage', { kinds: questApi.REWARD_KIND_LIST.join('|') }));
      const column = target === 'alert' ? 'type_templates' : 'method_type_templates';
      const map = { ...(current[column] ?? {}) };
      if (!name) {
        delete map[kind];
        await save({ [column]: map });
        return done(`quests.type.cleared.${target}`, { kind });
      }
      const doc = await getTemplate(guildId, name).catch(() => null);
      if (!doc) return reply(t(lang, 'quests.embedNotFound', { name }));
      map[kind] = doc.name;
      await save({ [column]: map });
      return done(`quests.type.set.${target}`, { kind, name: doc.name });
    }
    if (sub === 'thread') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const value = String(interaction.options.getString('value') ?? '').trim();
      if (action === 'on' || action === 'off') {
        await save({ auto_thread: action === 'on' });
        return done(action === 'off' ? 'quests.thread.off' : current.thread_ping ? 'quests.thread.onPing' : 'quests.thread.on');
      }
      if (action === 'ping' || action === 'noping') {
        await save({ thread_ping: action === 'ping' });
        return done(action === 'noping' ? 'quests.thread.noping' : current.role_id ? 'quests.thread.ping' : 'quests.thread.pingNoRole');
      }
      if (action === 'name') {
        await save({ thread_name: value ? value.slice(0, 100) : null });
        return done(value ? 'quests.thread.name' : 'quests.thread.nameReset', { name: value ? value.slice(0, 100) : DEFAULT_THREAD_NAME });
      }
      if (action === 'archive') {
        const minutes = Number(value);
        if (!ARCHIVE_MINUTES.includes(minutes)) return reply(t(lang, 'quests.thread.archiveUsage', { values: code(ARCHIVE_MINUTES) }));
        await save({ thread_archive: minutes });
        return done('quests.thread.archive', { count: minutes });
      }
      return reply(t(lang, 'quests.thread.usage'));
    }
    if (sub === 'method') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const value = String(interaction.options.getString('value') ?? '').trim();
      if (action === 'on' || action === 'off') {
        if (action === 'on' && !current.method_template && !String(current.method_text ?? '').trim()) return reply(t(lang, 'quests.method.writeFirst'));
        await save({ method_enabled: action === 'on' });
        return done(action === 'off' ? 'quests.method.off' : current.method_target === 'channel' ? 'quests.method.onChannel' : 'quests.method.onThread');
      }
      if (action === 'text') {
        if (!value) { await save({ method_text: null }); return done('quests.method.textRemoved'); }
        if (value.length > TEXT_LIMIT) return reply(t(lang, 'quests.method.textTooLong', { max: TEXT_LIMIT }));
        await save({ method_text: value });
        return done('quests.method.textSaved');
      }
      if (action === 'template') {
        if (!value) { await save({ method_template: null }); return done('quests.method.templateRemoved'); }
        const doc = await getTemplate(guildId, value).catch(() => null);
        if (!doc) return reply(t(lang, 'quests.embedNotFound', { name: value }));
        await save({ method_template: doc.name });
        return done('quests.method.templateSet', { name: doc.name });
      }
      if (action === 'thread') {
        await save({ method_target: 'thread' });
        return done('quests.method.targetThread');
      }
      if (action === 'channel') {
        const id = /^(?:<#)?(\d{15,25})>?$/.exec(value)?.[1] ?? null;
        if (value && !id) return reply(t(lang, 'quests.method.channelUsage'));
        const channel = id ? await interaction.guild.channels.fetch(id).catch(() => null) : null;
        if (id && !channel?.isTextBased?.()) return reply(t(lang, 'quests.method.channelNotFound'));
        await save({ method_target: 'channel', method_channel_id: channel?.id ?? null });
        return done(channel ? 'quests.method.targetChannel' : 'quests.method.targetAlertChannel', { channel: `${channel}` });
      }
      if (action === 'ping' || action === 'noping') {
        await save({ method_ping: action === 'ping' });
        return done(action === 'noping' ? 'quests.method.noping' : current.role_id ? 'quests.method.ping' : 'quests.method.pingNoRole');
      }
      if (action === 'send') {
        const result = await sendMethodNow(interaction.guild, { ...current, guild_id: guildId }, { questId: value || null, lang });
        return reply(`${result.ok ? EMOJI.APPROVE : EMOJI.DENY}  ${result.message}`);
      }
      if (action === 'show') {
        const yesNo = (value) => t(lang, value ? 'quests.yes' : 'quests.no');
        const none = t(lang, 'quests.none');
        const where = current.method_target === 'channel'
          ? (current.method_channel_id ? `<#${current.method_channel_id}>` : t(lang, 'quests.show.alertChannel'))
          : t(lang, 'quests.show.alertThread');
        const lines = [
          t(lang, 'quests.show.sent', { value: yesNo(current.method_enabled) }),
          t(lang, 'quests.show.where', { value: where }),
          t(lang, 'quests.show.ping', { value: yesNo(current.method_ping) }),
          t(lang, 'quests.show.embed', { value: current.method_template ? `\`${current.method_template}\`` : none }),
          t(lang, 'quests.show.text', { value: String(current.method_text ?? '').trim() ? `\n${String(current.method_text).slice(0, 600)}` : none }),
        ];
        return reply(lines.join('\n'));
      }
      return reply(t(lang, 'quests.method.usage'));
    }
    if (sub === 'list' || sub === 'test') {
      let quests;
      try { quests = (await questApi.fetchQuests({ force: true })).quests.filter((quest) => questApi.isActive(quest)); } catch (error) { return reply(`${EMOJI.DENY}  ${t(lang, 'quests.readFailed', { error: sourceProblem(error.message, lang) })}`); }
      quests.sort((a, b) => (b.startsAt - a.startsAt) || b.id.localeCompare(a.id));
      if (!quests.length) return reply(t(lang, 'quests.noActive'));
      if (sub === 'list') return interaction.editReply(buildQuestList(quests, { page: interaction.options.getInteger('page') ?? 1, lang }));
      const payload = await questMessage(interaction.guild, { ...current, role_id: null }, quests[0], 'new', lang);
      await interaction.channel.send(payload).catch(() => null);
      return done('quests.test.sent');
    }
    const status = questApi.getStatus();
    const none = t(lang, 'quests.none');
    const all = t(lang, 'quests.all');
    const off = t(lang, 'quests.off');
    const pairs = (map) => Object.entries(map ?? {}).map(([k, v]) => `${k} → \`${v}\``).join(', ');
    const thread = current.auto_thread ? t(lang, current.thread_ping ? 'quests.status.threadOnPing' : 'quests.status.threadOn') : off;
    const method = current.method_enabled
      ? t(lang, current.method_target === 'channel' ? 'quests.status.methodChannel' : 'quests.status.methodThread')
      : off;
    const sources = status.ok === null
      ? t(lang, 'quests.status.notAsked')
      : status.sources.filter((source) => source.ok !== null).map((source) => (source.ok ? t(lang, 'quests.status.sourceOk', { name: source.name }) : t(lang, 'quests.status.sourceFailing', { name: source.name, error: sourceProblem(source.error, lang) }))).join(', ');
    const lines = [
      t(lang, 'quests.status.alerts', { value: current.enabled && current.channel_id ? t(lang, 'quests.status.onIn', { channel: `<#${current.channel_id}>` }) : t(lang, 'quests.status.alertsOff') }),
      t(lang, 'quests.status.role', { value: current.role_id ? `<@&${current.role_id}>` : none }),
      t(lang, 'quests.status.style', { value: current.style === 'template' && current.embed_template ? t(lang, 'quests.status.savedEmbed', { name: current.embed_template }) : t(lang, 'quests.status.card') }),
      t(lang, 'quests.status.filters', { rewards: current.reward_kinds.length ? current.reward_kinds.join(', ') : all, tasks: current.task_kinds.length ? current.task_kinds.join(', ') : all }),
      t(lang, 'quests.status.hides', { value: current.hide_sections.length ? current.hide_sections.join(', ') : t(lang, 'quests.status.nothing') }),
      `${t(lang, 'quests.status.byReward', { value: pairs(current.type_templates) || none })}${Object.keys(current.method_type_templates ?? {}).length ? ` · ${t(lang, 'quests.status.byRewardMethod', { value: pairs(current.method_type_templates) })}` : ''}`,
      t(lang, current.method_ping ? 'quests.status.threadMethodPings' : 'quests.status.threadMethod', { thread, method }),
      t(lang, 'quests.status.expiring', { value: current.expiring_hours ? `${current.expiring_hours} h` : off }),
      `${t(lang, 'quests.status.sources', { value: sources })}${status.count ? t(lang, 'quests.status.count', { count: status.count }) : ''}`,
    ];
    return reply(lines.join('\n'));
  },
};
