const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const voiceDb = require('../db/voiceMaster');
const voiceMaster = require('../commands/automation/voicemaster');
const { t, languageOf } = require('../i18n');
const { ack, answer } = require('../utils/interactionAck');

const PROMPT_EMOJI = { permit: '✅', reject: '🚫', transfer: '🔄', disconnect: '🔨' };

function getVoiceChannelId(interaction) {
  return interaction.guild?.voiceStates?.cache.get(interaction.user.id)?.channelId
    ?? interaction.member?.voice?.channelId
    ?? null;
}

async function handleButton(interaction) {
  const isBliPanel = interaction.customId.startsWith('vc:');
  const action = interaction.customId.slice(3);
  // Everything but the rename form is answered with a message, which can take longer than the 3 seconds Discord waits: Discord is told
  // first. (The form has to be the first thing said, so it cannot be announced.)
  if (action !== 'rename' && !(await ack(interaction))) return undefined;
  const lang = await languageOf(interaction);
  const joinFirst = () => answer(interaction, { content: t(lang, 'voicemaster.joinFirst'), flags: MessageFlags.Ephemeral });
  const channelId = getVoiceChannelId(interaction);

  if (action === 'rename') {
    if (!channelId) return joinFirst();
    const customId = isBliPanel ? `vcm:rename::${channelId}` : 'vm_modal_rename';
    return interaction.showModal(new ModalBuilder().setCustomId(customId).setTitle(t(lang, 'voicemaster.modal.title')).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel(t(lang, 'voicemaster.modal.name')).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true))));
  }

  if (['permit', 'reject', 'transfer', 'disconnect'].includes(action)) {
    if (!channelId) return joinFirst();
    const prompt = t(lang, `voicemaster.prompt.${action}`, { emoji: PROMPT_EMOJI[action] });
    const customId = isBliPanel
      ? `vc:do_${action}::${channelId}`
      : `vm_select:${action}`;
    return answer(interaction, { content: isBliPanel ? prompt : t(lang, 'voicemaster.selectMember'), components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(t(lang, 'voicemaster.select.menu')))], flags: MessageFlags.Ephemeral });
  }

  if (action === 'limit_up' || action === 'limit_down') {
    if (!channelId) return joinFirst();
    const temp = await voiceDb.getTemp(channelId);
    if (!temp) return joinFirst();
    const next = Math.max(0, Math.min(99, (temp.user_limit || 0) + (action === 'limit_up' ? 1 : -1)));
    return voiceMaster.executeAction(interaction, 'limit', { limit: next, channelId });
  }

  if (action === 'info') {
    const temp = channelId ? await voiceDb.getTemp(channelId) : null;
    const yesNo = (value) => t(lang, value ? 'voicemaster.yes' : 'voicemaster.no');
    const content = temp
      ? t(lang, 'voicemaster.info.text', { owner: `<@${temp.owner_id}>`, limit: temp.user_limit || t(lang, 'voicemaster.unlimited'), locked: yesNo(temp.is_locked), hidden: yesNo(temp.is_ghosted) })
      : t(lang, 'voicemaster.notManaged');
    return answer(interaction, { content, flags: MessageFlags.Ephemeral });
  }

  return voiceMaster.executeAction(interaction, action, { channelId });
}

async function handleModal(interaction) {
  if (interaction.customId !== 'vm_modal_rename' && !interaction.customId.startsWith('vcm:rename::')) return;
  if (!(await ack(interaction))) return undefined;
  const channelId = interaction.customId.startsWith('vcm:rename::')
    ? interaction.customId.slice('vcm:rename::'.length) || undefined
    : undefined;
  return voiceMaster.executeAction(interaction, 'rename', { name: interaction.fields.getTextInputValue('name'), channelId });
}

async function handleSelect(interaction) {
  const known = interaction.customId.startsWith('vm_select:') || interaction.customId.startsWith('vc:do_');
  if (known && !(await ack(interaction))) return undefined;
  if (interaction.customId.startsWith('vm_select:')) {
    return voiceMaster.executeAction(interaction, interaction.customId.slice('vm_select:'.length), { userId: interaction.values[0] });
  }

  if (!interaction.customId.startsWith('vc:do_')) return;
  const payload = interaction.customId.slice('vc:do_'.length);
  const [action, channelId] = payload.split('::');
  return voiceMaster.executeAction(interaction, action, { userId: interaction.values[0], channelId: channelId || undefined });
}

module.exports = { handleButton, handleModal, handleSelect };
