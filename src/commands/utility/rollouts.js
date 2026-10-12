// Alerts for Discord's rollouts: a message in a channel when an experiment appears or its rollout changes, in a card the
// server can style or in one of its saved embeds. The data comes from a community list of Discord's experiments. Anyone with Manage
// Server can set it up (config.js can limit it to the team and the testers); the dashboard has the full set of options.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const rolloutsDb = require('../../db/rollouts');
const rolloutApi = require('../../utils/rolloutApi');
const { rolloutMessage, SECTIONS } = require('../../utils/rolloutMessages');
const { canUseRollouts } = require('../../utils/rolloutAlerts');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const EVENT_KINDS = ['new', 'increase', 'decrease', 'status'];

const HELP = [
  '## Rollout alerts',
  'A message in a channel when a Discord experiment appears, its rollout grows or shrinks, or its status changes. Many changes at once are sent in order, a few cards at a time.',
  '**Set it up**',
  '- `!rollouts enable #channel [@role]` turns it on. `!rollouts disable` turns it off.',
  '- `!rollouts role [@role]` changes the role that is pinged, or none.',
  '**Choose what you get**',
  `- \`!rollouts kinds user guild\` only some experiments (${rolloutApi.KINDS.join(', ')}). \`!rollouts kinds all\` for every one.`,
  `- \`!rollouts events new increase\` only some events (${EVENT_KINDS.join(', ')}).`,
  '- `!rollouts min 5` ignores changes smaller than 5 points. `!rollouts unrolled on` also announces experiments with no rollout yet.',
  '**Make it yours**',
  '- `!rollouts style card` or `!rollouts style template <saved embed>`. `!rollouts card hide|show <section>` and `!rollouts color #ff91c2` change the card.',
  '- The dashboard has everything in one page, with a preview and a different saved embed for each kind.',
  '**Check it**',
  '- `!rollouts test` sends an example here. `!rollouts list` shows what is rolling out now.',
  '- `!rollouts queue` shows what is waiting to be sent. `!rollouts status` shows your settings.',
].join('\n');

/** A list typed as `user, guild` (or `all`) as the values it may hold, or null when one of them is not valid. */
function readList(text, allowed) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'none') return [];
  const values = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  return values.every((value) => allowed.includes(value)) ? values : null;
}

module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
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
    const reply = (text) => interaction.editReply({ components: [textCard(text, null)], flags: MessageFlags.IsComponentsV2 });
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    if (!canUseRollouts(interaction.user.id)) return reply(`${EMOJI.DENY}  Rollout alerts are only available to Petto's team and testers for now.`);
    const sub = interaction.options.getSubcommand();
    if (!['list', 'help'].includes(sub) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply(`${EMOJI.DENY}  You need the Manage Server permission to change the rollout alerts. Anyone can use \`rollouts list\` and \`rollouts help\`.`);
    }
    await ensureGuild(interaction.guild.id);
    const guildId = interaction.guild.id;
    const current = (await rolloutsDb.getConfig(guildId)) ?? rolloutsDb.DEFAULTS;
    const save = (changes) => rolloutsDb.upsertConfig(guildId, changes);

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('role');
      await save({ enabled: true, channel_id: channel.id, ...(role ? { role_id: role.id } : {}) });
      return reply(`${EMOJI.APPROVE}  Rollout alerts will be sent in ${channel}${role ? ` and will ping ${role}` : ''}. The first check only remembers what exists, so you will hear about the next change. Try \`!rollouts test\` to see how it looks, or \`!rollouts help\` for everything you can set.`);
    }
    if (sub === 'disable') { await save({ enabled: false }); return reply(`${EMOJI.APPROVE}  Rollout alerts are off.`); }
    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      await save({ role_id: role?.id ?? null });
      return reply(`${EMOJI.APPROVE}  ${role ? `Alerts will ping ${role}.` : 'Alerts will not ping a role.'}`);
    }
    if (sub === 'style') {
      const style = String(interaction.options.getString('style', true)).trim().toLowerCase();
      if (style === 'card') { await save({ style: 'card' }); return reply(`${EMOJI.APPROVE}  Alerts use the card.`); }
      const name = String(interaction.options.getString('template') ?? current.embed_template ?? '').trim();
      const doc = name ? await getTemplate(guildId, name).catch(() => null) : null;
      if (!doc) return reply(name ? `No saved embed named \`${name}\` was found. Make one in the dashboard, under Embeds. Its variables start with \`{rollout.…}\`.` : 'Give the name of a saved embed: `rollouts style template <name>`.');
      await save({ style: 'template', embed_template: doc.name });
      return reply(`${EMOJI.APPROVE}  Alerts now use the saved embed \`${doc.name}\`. If it is missing or broken, the card is sent instead.`);
    }
    if (sub === 'kinds' || sub === 'events') {
      const allowed = sub === 'kinds' ? rolloutApi.KINDS : EVENT_KINDS;
      const values = readList(interaction.options.getString(sub), allowed);
      if (values === null) return reply(`Choose from: ${allowed.map((v) => `\`${v}\``).join(', ')}, or \`all\`.`);
      await save({ [sub]: values });
      return reply(`${EMOJI.APPROVE}  ${values.length ? `Only ${sub}: ${values.join(', ')}.` : `Alerts for every kind of ${sub === 'kinds' ? 'experiment' : 'event'}.`}`);
    }
    if (sub === 'min') {
      const points = Number(interaction.options.getNumber('points', true));
      await save({ min_change: points });
      return reply(`${EMOJI.APPROVE}  ${points ? `Changes smaller than ${points} points are ignored.` : 'Every change is announced.'}`);
    }
    if (sub === 'unrolled') {
      const on = String(interaction.options.getString('value', true)).toLowerCase() === 'on';
      await save({ include_unrolled: on });
      return reply(`${EMOJI.APPROVE}  New experiments ${on ? 'are announced even before they have a rollout' : 'are announced when they get a rollout'}.`);
    }
    if (sub === 'card') {
      const action = String(interaction.options.getString('action', true)).trim().toLowerCase();
      const section = String(interaction.options.getString('section') ?? '').trim().toLowerCase();
      if (action === 'reset') { await save({ hide_sections: [], accent_color: null }); return reply(`${EMOJI.APPROVE}  The card shows everything again, with the color of each event.`); }
      if (!['hide', 'show'].includes(action) || !SECTIONS.includes(section)) return reply(`Use \`rollouts card hide|show <section>\` with one of: ${SECTIONS.map((v) => `\`${v}\``).join(', ')}.`);
      const hidden = new Set(current.hide_sections);
      if (action === 'hide') hidden.add(section); else hidden.delete(section);
      await save({ hide_sections: [...hidden] });
      return reply(`${EMOJI.APPROVE}  The card ${action === 'hide' ? 'hides' : 'shows'} \`${section}\`.`);
    }
    if (sub === 'color') {
      const hex = String(interaction.options.getString('hex') ?? '').trim().replace(/^#/, '');
      if (hex && !/^[0-9a-f]{6}$/i.test(hex)) return reply('Give the color as 6 hex digits, such as `#ff91c2`.');
      await save({ accent_color: hex ? parseInt(hex, 16) : null });
      return reply(`${EMOJI.APPROVE}  ${hex ? `The card color is #${hex.toLowerCase()}.` : 'The card uses the color of each event.'}`);
    }

    if (sub === 'help') return reply(HELP);
    if (sub === 'queue') {
      const action = String(interaction.options.getString('action') ?? 'show').toLowerCase();
      if (action === 'clear') { await rolloutsDb.clearGuildQueue(guildId); return reply(`${EMOJI.APPROVE}  The queue is empty. What was waiting will not be sent.`); }
      const waiting = await rolloutsDb.countPending(guildId);
      return reply(waiting ? `**${waiting}** alert${waiting === 1 ? '' : 's'} waiting. They go out one message every few seconds, grouped in cards of up to 10 changes when there are many. \`!rollouts queue clear\` empties it.` : 'Nothing is waiting to be sent.');
    }

    if (sub === 'list' || sub === 'test') {
      let list;
      try { list = (await rolloutApi.fetchRollouts({ force: true })).list; } catch (error) { return reply(`${EMOJI.DENY}  The list could not be read: ${error.message}`); }
      const live = list.filter((entry) => ['rolling_out', 'ab_test', 'segmented'].includes(entry.status) && entry.percent != null);
      if (sub === 'list') {
        if (!live.length) return reply('No experiment is rolling out right now.');
        const lines = live.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0)).slice(0, 20).map((entry) => `- **${entry.title}** · ${Number(entry.percent.toFixed(2))}% · ${rolloutApi.STATUS_LABELS[entry.status] ?? entry.status}`);
        return reply(`## Rolling out now\n${lines.join('\n')}${live.length > 20 ? `\n-# and ${live.length - 20} more` : ''}`);
      }
      const sample = live[0] ?? list[0];
      const event = { type: 'increase', rollout: sample, before: { ...sample, percent: Math.max(0, (sample.percent ?? 0) - 12.5), variants: sample.variants.map((variant) => ({ ...variant, percent: Math.max(0, (variant.percent ?? 0) - 12.5) })) }, change: 12.5 };
      const payload = await rolloutMessage(interaction.guild, { ...current, role_id: null }, event);
      await interaction.channel.send(payload).catch(() => null);
      return reply(`${EMOJI.APPROVE}  Sent an example here (with an invented +12.5% change on a real experiment).`);
    }

    const status = rolloutApi.getStatus();
    const waiting = await rolloutsDb.countPending(guildId).catch(() => 0);
    return reply([
      `**Alerts:** ${current.enabled && current.channel_id ? `on in <#${current.channel_id}>` : 'off'}`,
      `**Role:** ${current.role_id ? `<@&${current.role_id}>` : 'none'}`,
      `**Style:** ${current.style === 'template' && current.embed_template ? `saved embed \`${current.embed_template}\`` : 'card'}`,
      `**Experiments:** ${current.kinds.length ? current.kinds.join(', ') : 'all'} · **Events:** ${current.events.length ? current.events.join(', ') : 'all'}`,
      `**Minimum change:** ${current.min_change || 0} points · **Unrolled:** ${current.include_unrolled ? 'announced' : 'not announced'}`,
      `**Card hides:** ${current.hide_sections.length ? current.hide_sections.join(', ') : 'nothing'}`,
      `**Queue:** ${waiting ? `${waiting} waiting` : 'empty'}`,
      `**List:** ${status.ok === null ? 'not asked yet' : status.ok ? `ok, ${status.count} experiments` : `failing (${status.error})`}`,
      '-# More options in the dashboard. `!rollouts help` shows every command.',
    ].join('\n'));
  },
};
