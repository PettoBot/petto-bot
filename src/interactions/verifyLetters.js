// The letters check inside Discord: a button in the verification DM shows a picture, and the member types the letters in a small form.
// The picture's ticket is kept in memory for a few minutes (a restart just asks for a new picture); five wrong answers lock it, as on the page.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { getConfig } = require('../db/verificationConfig');
const { hasEverVerified } = require('../db/verificationRedemptions');
const captcha = require('../utils/verifyCaptcha');

const { TICKET_TTL_SECONDS } = captcha;
const { methodOf, inDiscord } = require('../utils/verifyMethod');
const { applyVerification } = require('../utils/verifyApply');
const logger = require('../utils/logger');

const PREFIX = 'vfy';
const ids = { start: (guildId) => `${PREFIX}:start:${guildId}`, type: (guildId) => `${PREFIX}:type:${guildId}`, answer: (guildId) => `${PREFIX}:answer:${guildId}` };
const V2 = MessageFlags.IsComponentsV2;

const tickets = new Map(); // `${guildId}:${userId}` -> { ticket, jti, until }
const key = (guildId, userId) => `${guildId}:${userId}`;

/** The button of the verification DM that starts the letters check. */
function startButton(guildId) {
  return new ButtonBuilder().setCustomId(ids.start(guildId)).setLabel('Verify here in Discord').setStyle(ButtonStyle.Primary);
}

const say = (interaction, text) => interaction.reply({ components: [new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(text))], flags: V2 });

/** Whether this member still has to verify in that server, with the settings; or `{ error }` with what to tell them. */
async function situation(client, guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const settings = guild ? await getConfig(guildId).catch(() => null) : null;
  if (!guild || !settings?.enabled || !inDiscord(methodOf(settings))) return { error: 'This server does not ask for the letters check in Discord.' };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { error: 'You are not in that server any more.' };
  if (settings.unverified_role_id && !member.roles.cache.has(settings.unverified_role_id) && await hasEverVerified(guildId, userId).catch(() => false)) return { error: 'You are already verified.' };
  return { guild, member, settings };
}

/** Sends a picture with the buttons to type the letters or to get another one. */
async function showPicture(interaction, guildId) {
  const state = await situation(interaction.client, guildId, interaction.user.id);
  if (state.error) return say(interaction, state.error);
  const jti = `dc:${guildId}:${interaction.user.id}`;
  const challenge = captcha.createChallenge(jti);
  tickets.set(key(guildId, interaction.user.id), { ticket: challenge.ticket, jti, until: Date.now() + TICKET_TTL_SECONDS * 1000 });
  if (tickets.size > 2_000) tickets.delete(tickets.keys().next().value);
  const container = new ContainerBuilder().setAccentColor(0x8c7cff)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Verify for ${state.guild.name}\nType the 5 letters and numbers you see. Small or big letters both work. The picture lasts ${Math.round(TICKET_TTL_SECONDS / 60)} minutes.`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://verify.png')))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ids.type(guildId)).setLabel('Type the letters').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(ids.start(guildId)).setLabel('New picture').setStyle(ButtonStyle.Secondary),
    ));
  return interaction.reply({ components: [container], files: [new AttachmentBuilder(challenge.png, { name: 'verify.png' })], flags: V2 });
}

async function handleButton(interaction) {
  const [, action, guildId] = interaction.customId.split(':');
  if (!/^\d{15,25}$/.test(guildId ?? '')) return undefined;
  if (action === 'start') return showPicture(interaction, guildId);
  if (action === 'type') {
    const modal = new ModalBuilder().setCustomId(ids.answer(guildId)).setTitle('Verification')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('letters').setLabel('The letters of the picture').setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(12).setRequired(true)));
    return interaction.showModal(modal);
  }
  return undefined;
}

async function handleModal(interaction) {
  const guildId = interaction.customId.split(':')[2];
  if (!/^\d{15,25}$/.test(guildId ?? '')) return undefined;
  const state = await situation(interaction.client, guildId, interaction.user.id);
  if (state.error) return say(interaction, state.error);
  const kept = tickets.get(key(guildId, interaction.user.id));
  if (!kept || kept.until < Date.now()) return say(interaction, 'That picture expired. Press **Verify here in Discord** to get a new one.');
  const result = captcha.checkAnswer(kept.jti, kept.ticket, interaction.fields.getTextInputValue('letters'));
  if (!result.ok) {
    if (result.reason === 'locked') return say(interaction, 'Too many wrong tries. Wait a few minutes and press the button again.');
    tickets.delete(key(guildId, interaction.user.id));
    return say(interaction, 'Those letters are not right. Press **Verify here in Discord** to get a new picture and try again.');
  }
  tickets.delete(key(guildId, interaction.user.id));
  try {
    const applied = await applyVerification({ client: interaction.client, guild: state.guild, member: state.member, settings: state.settings, jti: `dc${Date.now().toString(36)}${state.member.id}` });
    return say(interaction, applied.ok ? `You're verified. You now have access to **${state.guild.name}**.` : 'You are already verified.');
  } catch (err) {
    logger.error('Failed to apply verification roles (letters in Discord):', err);
    return say(interaction, 'Those letters are right, but I was unable to update your roles. Contact a moderator.');
  }
}

module.exports = { PREFIX, startButton, handleButton, handleModal, ids };
