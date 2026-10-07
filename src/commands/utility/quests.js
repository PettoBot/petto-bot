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
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    if (!canUseQuests(interaction.user.id)) {
      return reply(`${EMOJI.DENY}  Quest alerts are in testing and only available to Petto's team for now.`);
    }
    const sub = interaction.options.getSubcommand();
    // Anyone can see the quests that are active; the settings and the test are for who manages the server.
    if (sub !== 'list' && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply(`${EMOJI.DENY}  You need the Manage Server permission to change the quest alerts. Anyone can use \`quests list\`.`);
    }
    await ensureGuild(interaction.guild.id);
    const guildId = interaction.guild.id;
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
    if (sub === 'resend') {
      if (!current.enabled || !current.channel_id) return reply(`${EMOJI.DENY}  Turn the alerts on first with \`quests enable\`.`);
      let result;
      try { result = await resendMissing(interaction.client, { ...current, guild_id: guildId }); } catch (error) { return reply(`${EMOJI.DENY}  The quests could not be read: ${error.message}`); }
      if (!result.missing) return reply(`${EMOJI.APPROVE}  Nothing is missing: every active quest that passes your filters was already posted.`);
      return reply(`${result.sent ? EMOJI.APPROVE : EMOJI.DENY}  Sent ${result.sent} of ${result.missing} missing quest${result.missing === 1 ? '' : 's'} in <#${current.channel_id}>.${result.left ? ` ${result.left} more are left: run \`quests resend\` again.` : ''}${result.sent < Math.min(result.missing, 10) ? ' Some could not be sent, check that I can write in that channel.' : ''}`);
    }
    if (sub === 'type') {
      const kind = String(interaction.options.getString('kind', true)).trim().toLowerCase();
      const target = String(interaction.options.getString('target', true)).trim().toLowerCase();
      const name = String(interaction.options.getString('template') ?? '').trim();
      if (!questApi.REWARD_KIND_LIST.includes(kind) || !['alert', 'method'].includes(target)) return reply(`Use \`quests type <${questApi.REWARD_KIND_LIST.join('|')}> <alert|method> [saved embed]\`.`);
      const column = target === 'alert' ? 'type_templates' : 'method_type_templates';
      const map = { ...(current[column] ?? {}) };
      if (!name) {
        delete map[kind];
        await save({ [column]: map });
        return reply(`${EMOJI.APPROVE}  Quests with ${kind} rewards use the general ${target === 'alert' ? 'design' : 'method'} again.`);
      }
      const doc = await getTemplate(guildId, name).catch(() => null);
      if (!doc) return reply(`No saved embed named \`${name}\` was found. Make one in the dashboard, under Embeds.`);
      map[kind] = doc.name;
      await save({ [column]: map });
      return reply(`${EMOJI.APPROVE}  Quests with a ${kind} reward use the saved embed \`${doc.name}\` for the ${target}. If it is missing or broken, the general one is used.`);
    }
    if (sub === 'thread') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const value = String(interaction.options.getString('value') ?? '').trim();
      if (action === 'on' || action === 'off') {
        await save({ auto_thread: action === 'on' });
        return reply(`${EMOJI.APPROVE}  ${action === 'on' ? `Each alert will get a thread${current.thread_ping ? ' and ping the role in it' : ''}. I need the Create Public Threads permission in the alert channel.` : 'Alerts will not open a thread.'}`);
      }
      if (action === 'ping' || action === 'noping') {
        await save({ thread_ping: action === 'ping' });
        return reply(`${EMOJI.APPROVE}  ${action === 'ping' ? (current.role_id ? 'The role is pinged in each thread, so its members are added to it.' : 'The role will be pinged in each thread once you set one with `quests role`.') : 'The threads do not ping the role.'}`);
      }
      if (action === 'name') {
        await save({ thread_name: value ? value.slice(0, 100) : null });
        return reply(`${EMOJI.APPROVE}  ${value ? `Threads are named \`${value.slice(0, 100)}\`. Quest variables such as \`{quest.name}\` work.` : `Threads are named \`${DEFAULT_THREAD_NAME}\` again.`}`);
      }
      if (action === 'archive') {
        const minutes = Number(value);
        if (!ARCHIVE_MINUTES.includes(minutes)) return reply(`Use one of: ${ARCHIVE_MINUTES.map((n) => `\`${n}\``).join(', ')} (minutes before an idle thread hides itself).`);
        await save({ thread_archive: minutes });
        return reply(`${EMOJI.APPROVE}  An idle thread hides itself after ${minutes} minutes.`);
      }
      return reply('Use `quests thread on|off|ping|noping|name <title>|archive <minutes>`.');
    }
    if (sub === 'method') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const value = String(interaction.options.getString('value') ?? '').trim();
      if (action === 'on' || action === 'off') {
        if (action === 'on' && !current.method_template && !String(current.method_text ?? '').trim()) return reply('Write the method first: `quests method text <the message>`, or `quests method template <saved embed>`.');
        await save({ method_enabled: action === 'on' });
        return reply(`${EMOJI.APPROVE}  ${action === 'on' ? `The method will be sent with each new quest, ${current.method_target === 'channel' ? 'in the channel you chose' : 'in its thread'}.` : 'The method is not sent with the alerts. You can still send it with `quests method send`.'}`);
      }
      if (action === 'text') {
        if (!value) { await save({ method_text: null }); return reply(`${EMOJI.APPROVE}  The method text was removed.`); }
        if (value.length > TEXT_LIMIT) return reply(`The text can have up to ${TEXT_LIMIT} characters. For more, pictures or several parts, make a saved embed in the dashboard and use \`quests method template <name>\`.`);
        await save({ method_text: value });
        return reply(`${EMOJI.APPROVE}  The method text was saved. The quest variables such as \`{quest.name}\` work in it.`);
      }
      if (action === 'template') {
        if (!value) { await save({ method_template: null }); return reply(`${EMOJI.APPROVE}  The method does not use a saved embed.`); }
        const doc = await getTemplate(guildId, value).catch(() => null);
        if (!doc) return reply(`No saved embed named \`${value}\` was found. Make one in the dashboard, under Embeds.`);
        await save({ method_template: doc.name });
        return reply(`${EMOJI.APPROVE}  The method uses the saved embed \`${doc.name}\`, with text, pictures and everything it has. It goes before the plain text.`);
      }
      if (action === 'thread') {
        await save({ method_target: 'thread' });
        return reply(`${EMOJI.APPROVE}  The method goes in the thread of each alert (turn the threads on with \`quests thread on\`; without a thread it goes in the alert channel).`);
      }
      if (action === 'channel') {
        const id = /^(?:<#)?(\d{15,25})>?$/.exec(value)?.[1] ?? null;
        if (value && !id) return reply('Mention the channel or give its id: `quests method channel #how-to`.');
        const channel = id ? await interaction.guild.channels.fetch(id).catch(() => null) : null;
        if (id && !channel?.isTextBased?.()) return reply('I cannot find that text channel.');
        await save({ method_target: 'channel', method_channel_id: channel?.id ?? null });
        return reply(`${EMOJI.APPROVE}  The method goes in ${channel ? channel : 'the alert channel'}.`);
      }
      if (action === 'ping' || action === 'noping') {
        await save({ method_ping: action === 'ping' });
        return reply(`${EMOJI.APPROVE}  ${action === 'ping' ? (current.role_id ? 'The method pings the role.' : 'The method will ping the role once you set one with `quests role`.') : 'The method does not ping.'}`);
      }
      if (action === 'send') {
        const result = await sendMethodNow(interaction.guild, { ...current, guild_id: guildId }, { questId: value || null });
        return reply(`${result.ok ? EMOJI.APPROVE : EMOJI.DENY}  ${result.message}`);
      }
      if (action === 'show') {
        const lines = [
          `**Sent with the alerts:** ${current.method_enabled ? 'yes' : 'no'}`,
          `**Where:** ${current.method_target === 'channel' ? (current.method_channel_id ? `<#${current.method_channel_id}>` : 'the alert channel') : 'the thread of the alert'}`,
          `**Ping:** ${current.method_ping ? 'yes' : 'no'}`,
          `**Saved embed:** ${current.method_template ? `\`${current.method_template}\`` : 'none'}`,
          `**Text:** ${String(current.method_text ?? '').trim() ? `\n${String(current.method_text).slice(0, 600)}` : 'none'}`,
        ];
        return reply(lines.join('\n'));
      }
      return reply('Use `quests method on|off|send|text <message>|template <saved embed>|thread|channel <#channel>|ping|noping|show`.');
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
      `**By reward:** ${Object.entries(current.type_templates ?? {}).map(([k, v]) => `${k} → \`${v}\``).join(', ') || 'none'}${Object.keys(current.method_type_templates ?? {}).length ? ` · method: ${Object.entries(current.method_type_templates).map(([k, v]) => `${k} → \`${v}\``).join(', ')}` : ''}`,
      `**Thread:** ${current.auto_thread ? `on${current.thread_ping ? ', pings the role' : ''}` : 'off'} · **Method:** ${current.method_enabled ? (current.method_target === 'channel' ? 'on, in a channel' : 'on, in the thread') : 'off'}${current.method_ping ? ', pings' : ''}`,
      `**Before it ends:** ${current.expiring_hours ? `${current.expiring_hours} h` : 'off'}`,
      `**Quest sources:** ${status.ok === null ? 'not asked yet' : status.sources.filter((source) => source.ok !== null).map((source) => `${source.name} ${source.ok ? 'ok' : `failing (${source.error})`}`).join(', ')}${status.count ? `, ${status.count} quests` : ''}`,
    ];
    return reply(lines.join('\n'));
  },
};
