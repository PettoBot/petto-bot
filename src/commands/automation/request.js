// Requests for members: ask for something, see the open ones. The staff claims and finishes them with the buttons of the
// card; the settings are in `!requestconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const requestsDb = require('../../db/requests');
const { requestCard } = require('../../utils/requestCards');
const { templatePayload } = require('../../utils/templatedMessage');
const { resolve } = require('../../utils/embedVariables');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const DEFAULT_CREATED = '{user.mention} your request #{request.number} is in. The staff will look at it: {request.link}';
const MAX_TEXT = 1000;
const STATUS_TEXT = { open: 'open', claimed: 'claimed' };

const reply = (interaction, component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });

async function createRequest(interaction) {
  const config = await requestsDb.getConfig(interaction.guild.id);
  if (!config?.enabled || !config.channel_id) return reply(interaction, textCard('Requests are not turned on in this server. An admin can set them up with `!requestconfig`.'));
  const text = interaction.options.getString('text', true).trim().slice(0, MAX_TEXT);
  if (!text) return reply(interaction, textCard('Write what you are asking for.'));
  const open = await requestsDb.countOpenBy(interaction.guild.id, interaction.user.id);
  if (open >= config.max_open) return reply(interaction, textCard(`You already have ${open} open requests. Wait for one to be finished, or cancel one.`));
  const channel = await interaction.guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return reply(interaction, textCard('The channel for requests is not available. Tell an admin.'));

  const request = await requestsDb.create({ guildId: interaction.guild.id, userId: interaction.user.id, content: text });
  const ping = config.ping_role_id ? `<@&${config.ping_role_id}>` : null;
  const card = await channel.send({ ...(ping ? { content: ping } : {}), components: [requestCard(request)], flags: MessageFlags.IsComponentsV2, allowedMentions: { roles: config.ping_role_id ? [config.ping_role_id] : [] } }).catch(() => null);
  if (!card) {
    await requestsDb.update(interaction.guild.id, request.number, { status: 'cancelled' });
    return reply(interaction, textCard('I could not post the request. An admin has to check my permissions in the requests channel.'));
  }
  await requestsDb.update(interaction.guild.id, request.number, { channel_id: channel.id, message_id: card.id });

  const link = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${card.id}`;
  const ctx = { guild: interaction.guild, member: interaction.member, user: interaction.user, channel: interaction.channel, request: { number: String(request.number), text, link, channel: `<#${channel.id}>`, status: 'Open' } };
  const saved = config.messages?.created ?? {};
  const payload = saved.template ? await templatePayload(interaction.guild.id, saved.template, ctx) : null;
  if (payload) return interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
  const content = (await resolve(saved.text?.trim() ? saved.text.slice(0, 2000) : DEFAULT_CREATED, ctx)).slice(0, 2000);
  return reply(interaction, textCard(`${EMOJI.APPROVE}  ${content}`, 0xa5ea7a));
}

async function listRequests(interaction) {
  const mine = Boolean(interaction.options.getBoolean('mine'));
  const rows = await requestsDb.list(interaction.guild.id, { userId: mine ? interaction.user.id : null, limit: 15 });
  if (!rows.length) return reply(interaction, textCard(mine ? 'You have no open requests.' : 'There are no open requests.'));
  const lines = rows.map((row) => {
    const link = row.channel_id && row.message_id ? ` · [card](https://discord.com/channels/${interaction.guild.id}/${row.channel_id}/${row.message_id})` : '';
    return `**#${row.number}** ${STATUS_TEXT[row.status]} · <@${row.user_id}>${row.claimed_by ? ` · <@${row.claimed_by}>` : ''}\n> ${row.content.replace(/\n/g, ' ').slice(0, 80)}${link}`;
  });
  return reply(interaction, textCard([`### ${mine ? 'Your requests' : 'Open requests'}`, ...lines].join('\n')));
}

module.exports = {
  prefixOnly: true,
  aliases: ['req'],
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription('Ask the staff for something.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('make').setDescription('Make a request.').addStringOption((o) => o.setName('text').setDescription('What you are asking for').setRequired(true).setMaxLength(MAX_TEXT)))
    .addSubcommand((s) => s.setName('list').setDescription('See the open requests.').addBooleanOption((o) => o.setName('mine').setDescription('Only yours').setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    return interaction.options.getSubcommand() === 'make' ? createRequest(interaction) : listRequests(interaction);
  },
  DEFAULT_CREATED,
};
