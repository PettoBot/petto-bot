// Alerts for Discord's rollouts: a message in a channel when an experiment appears or its rollout changes, in a card the
// server can style or in one of its saved embeds. The data comes from a community list of Discord's experiments. Anyone with Manage
// Server can set it up (config.js can limit it to the team and the testers); the dashboard has the full set of options.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const rolloutsDb = require('../../db/rollouts');
const rolloutApi = require('../../utils/rolloutApi');
const { rolloutMessage, SECTIONS } = require('../../utils/rolloutMessages');
const { register, buildPage } = require('../../utils/pager');
const { canUseRollouts } = require('../../utils/rolloutAlerts');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, languageOf } = require('../../i18n');
const { sourceProblem } = require('../../utils/sourceProblems');

const LIST_PER_PAGE = 10;
const LIST_MAX_PAGES = 10;

/** The date an experiment is named after (`2026-10-...` is 202610), 0 when it has none, to put the newest first. */
const rolloutMonth = (entry) => {
  const match = /^(\d{4})[-_](\d{1,2})/.exec(entry.id);
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
};

// The list of experiments, the newest first, ten to a page and at most ten pages.
register('rollouts', {
  perPage: LIST_PER_PAGE,
  async load(guild, { lang }) {
    const list = (await rolloutApi.fetchRollouts({ force: false })).list;
    // The list is already from the newest to the oldest; the month only puts the ones with no date at the end, and the sort is stable.
    const items = [...list].sort((a, b) => rolloutMonth(b) - rolloutMonth(a)).slice(0, LIST_PER_PAGE * LIST_MAX_PAGES).map((entry) => {
      const share = entry.percent != null ? ` · ${Number(entry.percent.toFixed(2))}%` : '';
      return `- **${entry.title}**${share} · ${rolloutApi.statusLabel(entry.status, lang)}\n  -# \`${entry.id}\``;
    });
    return { items, title: t(lang, 'rollouts.list.title'), subtitle: [t(lang, 'rollouts.list.subtitle')], empty: t(lang, 'rollouts.list.empty') };
  },
});

const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const EVENT_KINDS = ['new', 'increase', 'decrease', 'status'];

/** The help card of the rollout alerts, in `lang`. */
const helpText = (lang) => t(lang, 'rollouts.help', { kinds: rolloutApi.KINDS.join(', '), events: EVENT_KINDS.join(', ') });

/** A list typed as `user, guild` (or `all`) as the values it may hold, or null when one of them is not valid. */
function readList(text, allowed) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'none') return [];
  const values = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  return values.every((value) => allowed.includes(value)) ? values : null;
}

module.exports = {
  prefixOnly: true,
  aliases: ['rollout', 'experiments'],
  data: new SlashCommandBuilder()
    .setName('rollouts')
    .setDescription('Alerts when a Discord experiment appears or its rollout changes.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('enable').setDescription('Turn the alerts on in a channel, e.g. enable #rollouts @Role.')
      .addChannelOption((o) => o.setName('channel').setDescription('Where the alerts go').addChannelTypes(...textChannels).setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('A role to ping with each alert').setRequired(false)))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn the alerts off.'))
    .addSubcommand((s) => s.setName('role').setDescription('Set the role pinged with each alert, or leave it empty for none.')
      .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(false)))
    .addSubcommand((s) => s.setName('style').setDescription('Use the card, or one of your saved embeds.')
      .addStringOption((o) => o.setName('style').setDescription('card or template').setRequired(true).addChoices({ name: 'card', value: 'card' }, { name: 'template', value: 'template' }))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, for the template style').setRequired(false)))
    .addSubcommand((s) => s.setName('kinds').setDescription('Only some experiments: user, guild, apex_user, installation. E.g. kinds user guild.')
      .addStringOption((o) => o.setName('kinds').setDescription('For example: user, guild').setRequired(false)))
    .addSubcommand((s) => s.setName('events').setDescription('Only some events: new, increase, decrease, status. E.g. events new increase.')
      .addStringOption((o) => o.setName('events').setDescription('For example: new, increase').setRequired(false)))
    .addSubcommand((s) => s.setName('min').setDescription('Ignore changes smaller than this many points, e.g. min 5.')
      .addNumberOption((o) => o.setName('points').setDescription('0 to 100').setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand((s) => s.setName('unrolled').setDescription('Also announce new experiments that have no rollout yet.')
      .addStringOption((o) => o.setName('value').setDescription('on or off').setRequired(true).addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })))
    .addSubcommand((s) => s.setName('card').setDescription('Choose what the card shows.')
      .addStringOption((o) => o.setName('action').setDescription('hide, show or reset').setRequired(true).addChoices({ name: 'hide', value: 'hide' }, { name: 'show', value: 'show' }, { name: 'reset', value: 'reset' }))
      // i18n-ignore: builder description (translated in the cmd catalogs)
      .addStringOption((o) => o.setName('section').setDescription(`One of: ${SECTIONS.join(', ')}`).setRequired(false)))
    .addSubcommand((s) => s.setName('color').setDescription('Color of the card, as hex, or empty to use the color of each event.')
      .addStringOption((o) => o.setName('hex').setDescription('For example #ff91c2').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the experiments that are rolling out now.'))
    .addSubcommand((s) => s.setName('queue').setDescription('See how many alerts are waiting to be sent here, or empty the queue.')
      .addStringOption((o) => o.setName('action').setDescription('show (default) or clear').setRequired(false).addChoices({ name: 'show', value: 'show' }, { name: 'clear', value: 'clear' })))
    .addSubcommand((s) => s.setName('help').setDescription('How the rollout alerts work, with the commands and examples.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send an example alert here, to see how it looks.'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the settings, the queue and the state of the list.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    const done = (key, vars) => reply(`${EMOJI.APPROVE}  ${t(lang, key, vars)}`);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    if (!canUseRollouts(interaction.user.id)) return reply(`${EMOJI.DENY}  ${t(lang, 'rollouts.testing')}`);
    const sub = interaction.options.getSubcommand();
    if (!['list', 'help'].includes(sub) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply(`${EMOJI.DENY}  ${t(lang, 'rollouts.command.needsManageServer')}`);
    }
    await ensureGuild(interaction.guild.id);
    const guildId = interaction.guild.id;
    const current = (await rolloutsDb.getConfig(guildId)) ?? rolloutsDb.DEFAULTS;
    const save = (changes) => rolloutsDb.upsertConfig(guildId, changes);

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('role');
      await save({ enabled: true, channel_id: channel.id, ...(role ? { role_id: role.id } : {}) });
      return done(role ? 'rollouts.command.enabledRole' : 'rollouts.command.enabled', { channel: `${channel}`, role: `${role}` });
    }
    if (sub === 'disable') { await save({ enabled: false }); return done('rollouts.command.disabled'); }
    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      await save({ role_id: role?.id ?? null });
      return done(role ? 'rollouts.command.role' : 'rollouts.command.noRole', { role: `${role}` });
    }
    if (sub === 'style') {
      const style = String(interaction.options.getString('style', true)).trim().toLowerCase();
      if (style === 'card') { await save({ style: 'card' }); return done('rollouts.style.card'); }
      const name = String(interaction.options.getString('template') ?? current.embed_template ?? '').trim();
      const doc = name ? await getTemplate(guildId, name).catch(() => null) : null;
      if (!doc) return reply(name ? t(lang, 'rollouts.style.notFound', { name }) : t(lang, 'rollouts.style.giveName'));
      await save({ style: 'template', embed_template: doc.name });
      return done('rollouts.style.template', { name: doc.name });
    }
    if (sub === 'kinds' || sub === 'events') {
      const allowed = sub === 'kinds' ? rolloutApi.KINDS : EVENT_KINDS;
      const values = readList(interaction.options.getString(sub), allowed);
      if (values === null) return reply(t(lang, 'rollouts.filterSettings.choose', { values: allowed.map((v) => `\`${v}\``).join(', ') }));
      await save({ [sub]: values });
      return done(values.length ? `rollouts.filterSettings.${sub}Only` : `rollouts.filterSettings.${sub}All`, { values: values.join(', ') });
    }
    if (sub === 'min') {
      const points = Number(interaction.options.getNumber('points', true));
      await save({ min_change: points });
      return done(points ? 'rollouts.min.set' : 'rollouts.min.every', { points });
    }
    if (sub === 'unrolled') {
      const on = String(interaction.options.getString('value', true)).toLowerCase() === 'on';
      await save({ include_unrolled: on });
      return done(on ? 'rollouts.unrolled.on' : 'rollouts.unrolled.off');
    }
    if (sub === 'card') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const section = String(interaction.options.getString('section') ?? '').trim().toLowerCase();
      if (action === 'reset') { await save({ hide_sections: [], accent_color: null }); return done('rollouts.cardSettings.reset'); }
      if (!['hide', 'show'].includes(action) || !SECTIONS.includes(section)) return reply(t(lang, 'rollouts.cardSettings.usage', { sections: SECTIONS.map((v) => `\`${v}\``).join(', ') }));
      const hidden = new Set(current.hide_sections);
      if (action === 'hide') hidden.add(section); else hidden.delete(section);
      await save({ hide_sections: [...hidden] });
      return done(action === 'hide' ? 'rollouts.cardSettings.hides' : 'rollouts.cardSettings.shows', { section });
    }
    if (sub === 'color') {
      const hex = String(interaction.options.getString('hex') ?? '').trim().replace(/^#/, '');
      if (hex && !/^[0-9a-f]{6}$/i.test(hex)) return reply(t(lang, 'rollouts.color.invalid'));
      await save({ accent_color: hex ? parseInt(hex, 16) : null });
      return done(hex ? 'rollouts.color.set' : 'rollouts.color.none', { hex: hex.toLowerCase() });
    }

    if (sub === 'help') return reply(helpText(lang));
    if (sub === 'queue') {
      const action = String(interaction.options.getString('action') ?? 'show').toLowerCase();
      if (action === 'clear') { await rolloutsDb.clearGuildQueue(guildId); return done('rollouts.queue.cleared'); }
      const waiting = await rolloutsDb.countPending(guildId);
      return reply(waiting ? tn(lang, 'rollouts.queue.waiting', waiting, { count: waiting }) : t(lang, 'rollouts.queue.empty'));
    }

    if (sub === 'list' || sub === 'test') {
      let list;
      try { list = (await rolloutApi.fetchRollouts({ force: true })).list; } catch (error) { return reply(`${EMOJI.DENY}  ${t(lang, 'rollouts.readFailed', { error: sourceProblem(error.message, lang) })}`); }
      const live = list.filter((entry) => ['rolling_out', 'rolling_back', 'ab_test', 'segmented'].includes(entry.status) && entry.percent != null);
      if (sub === 'list') return interaction.editReply(await buildPage('rollouts', { guild: interaction.guild, userId: interaction.user.id, lang }));
      const sample = live[0] ?? list[0];
      const event = { type: 'increase', rollout: sample, before: { ...sample, percent: Math.max(0, (sample.percent ?? 0) - 12.5), variants: sample.variants.map((variant) => (variant.role === 'control' || ['0', '-1', 'none'].includes(String(variant.variant)) ? variant : { ...variant, percent: Math.max(0, (variant.percent ?? 0) - 12.5) })) }, change: 12.5 };
      const payload = await rolloutMessage(interaction.guild, { ...current, role_id: null }, event, lang);
      await interaction.channel.send(payload).catch(() => null);
      return done('rollouts.test.sent');
    }

    const status = rolloutApi.getStatus();
    const waiting = await rolloutsDb.countPending(guildId).catch(() => 0);
    const all = t(lang, 'rollouts.all');
    const list = status.ok === null
      ? t(lang, 'rollouts.settings.notAsked')
      : status.ok ? t(lang, 'rollouts.settings.listOk', { count: status.count }) : t(lang, 'rollouts.settings.listFailing', { error: sourceProblem(status.error, lang) });
    return reply([
      t(lang, 'rollouts.settings.alerts', { value: current.enabled && current.channel_id ? t(lang, 'rollouts.settings.onIn', { channel: `<#${current.channel_id}>` }) : t(lang, 'rollouts.settings.alertsOff') }),
      t(lang, 'rollouts.settings.role', { value: current.role_id ? `<@&${current.role_id}>` : t(lang, 'rollouts.none') }),
      t(lang, 'rollouts.settings.style', { value: current.style === 'template' && current.embed_template ? t(lang, 'rollouts.settings.savedEmbed', { name: current.embed_template }) : t(lang, 'rollouts.settings.card') }),
      t(lang, 'rollouts.settings.filters', { kinds: current.kinds.length ? current.kinds.join(', ') : all, events: current.events.length ? current.events.join(', ') : all }),
      t(lang, current.include_unrolled ? 'rollouts.settings.minUnrolledOn' : 'rollouts.settings.minUnrolledOff', { points: current.min_change || 0 }),
      t(lang, 'rollouts.settings.hides', { value: current.hide_sections.length ? current.hide_sections.join(', ') : t(lang, 'rollouts.settings.nothing') }),
      t(lang, 'rollouts.settings.queue', { value: waiting ? t(lang, 'rollouts.settings.waiting', { count: waiting }) : t(lang, 'rollouts.settings.queueEmpty') }),
      t(lang, 'rollouts.settings.list', { value: list }),
      `-# ${t(lang, 'rollouts.settings.more')}`,
    ].join('\n'));
  },
};
