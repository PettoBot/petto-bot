// The settings of requests for admins: where the cards go, who the staff is, how many a member can have open, and the time
// a claimed request has to be finished (Premium).
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const requestsDb = require('../../db/requests');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium } = require('../../db/premium');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);

module.exports = {
  prefixOnly: true,
  aliases: ['reqconfig'],
  data: new SlashCommandBuilder()
    .setName('requestconfig')
    .setDescription('Set up requests: channel, staff, limits and the reply.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('See the current settings.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn requests on or off.').addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('channel').setDescription('Where the request cards are posted.').addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((s) => s.setName('staff').setDescription('The role that claims and finishes requests. Empty: who can manage messages.').addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(false)))
    .addSubcommand((s) => s.setName('ping').setDescription('A role to ping with each new request. Empty: none.').addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(false)))
    .addSubcommand((s) => s.setName('limit').setDescription('How many open requests a member can have.').addIntegerOption((o) => o.setName('amount').setDescription('1 to 25').setMinValue(1).setMaxValue(25).setRequired(true)))
    .addSubcommand((s) => s.setName('timeout').setDescription('Premium: hours a claimed request has to be finished before it goes back to open. 0 is off.').addIntegerOption((o) => o.setName('hours').setDescription('0 to 720').setMinValue(0).setMaxValue(720).setRequired(true)))
    .addSubcommand((s) => s.setName('reply').setDescription('The answer to who makes a request, with text or a saved embed. "reset" goes back to the default.')
      .addStringOption((o) => o.setName('text').setDescription('The text, with {request.number}, {request.link}, {user.mention}').setMaxLength(2000).setRequired(false))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, or "none"').setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
    const config = (await requestsDb.getConfig(interaction.guild.id)) ?? { ...requestsDb.DEFAULTS };
    const save = (changes) => requestsDb.upsertConfig(interaction.guild.id, changes);
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const reply = config.messages?.created;
      return done(note(['### Requests', `State: **${config.enabled ? 'on' : 'off'}**`, `Channel: ${config.channel_id ? `<#${config.channel_id}>` : 'not set'}`, `Staff: ${config.staff_role_id ? `<@&${config.staff_role_id}>` : 'who can manage messages'}`, `Ping: ${config.ping_role_id ? `<@&${config.ping_role_id}>` : 'none'}`, `Open requests per member: ${config.max_open}`, `Time to finish a claimed request: ${config.completion_hours ? `${config.completion_hours} hours` : 'no limit'}`, `Reply: ${reply?.template ? `embed \`${reply.template}\`` : reply?.text ? 'changed' : 'default'}`].join('\n')));
    }
    if (sub === 'enable') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await save({ enabled });
      return done(ok(enabled ? (config.channel_id ? 'Requests are on.' : 'Requests are on. Choose where the cards go with `!requestconfig channel`.') : 'Requests are off.'));
    }
    if (sub === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      await save({ channel_id: channel.id });
      return done(ok(`The request cards go to ${channel}.`));
    }
    if (sub === 'staff' || sub === 'ping') {
      const role = interaction.options.getRole('role');
      await save(sub === 'staff' ? { staff_role_id: role?.id ?? null } : { ping_role_id: role?.id ?? null });
      return done(ok(sub === 'staff' ? (role ? `${role} claims and finishes requests.` : 'Who can manage messages claims and finishes requests.') : (role ? `${role} is pinged with each request.` : 'No role is pinged.')));
    }
    if (sub === 'limit') {
      const amount = interaction.options.getInteger('amount', true);
      await save({ max_open: amount });
      return done(ok(`A member can have ${amount} open request${amount === 1 ? '' : 's'}.`));
    }
    if (sub === 'timeout') {
      const hours = interaction.options.getInteger('hours', true);
      const premium = await getGuildPremium(interaction.guild.id).catch(() => ({ active: false }));
      if (hours > 0 && !premium?.active) return done(note('Sending a claimed request back to open by itself is a Premium feature.'));
      await save({ completion_hours: hours });
      return done(ok(hours ? `A claimed request goes back to open after ${hours} hours.` : 'A claimed request has no time limit.'));
    }
    // reply
    const text = interaction.options.getString('text');
    const template = (interaction.options.getString('template') ?? '').trim();
    const current = config.messages?.created ?? {};
    if (text === null && !template) return done(note(`**Reply**\n${current.template ? `Saved embed: \`${current.template}\`\n` : ''}${current.text?.trim() || require('./request').DEFAULT_CREATED}`));
    const created = { ...current };
    if (text !== null) { if (text.trim().toLowerCase() === 'reset') delete created.text; else created.text = text.trim().slice(0, 2000); }
    if (template) {
      if (template.toLowerCase() === 'none') delete created.template;
      else if (!(await getTemplate(interaction.guild.id, template).catch(() => null))?.data) return done(note(`There is no saved embed called \`${template}\`.`));
      else created.template = template;
    }
    await save({ messages: { ...(config.messages ?? {}), created } });
    return done(ok('Reply saved.'));
  },
};
