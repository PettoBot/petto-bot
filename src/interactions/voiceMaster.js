const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const voiceDb = require('../db/voiceMaster');
const voiceMaster = require('../commands/automation/voicemaster');

function getVoiceChannelId(interaction) {
  return interaction.guild?.voiceStates?.cache.get(interaction.user.id)?.channelId
    ?? interaction.member?.voice?.channelId
    ?? null;
}

async function handleButton(interaction) {
  const isBliPanel = interaction.customId.startsWith('vc:');
  const action = interaction.customId.slice(3);
  const channelId = getVoiceChannelId(interaction);

  if (action === 'rename') {
    if (!channelId) return interaction.reply({ content: 'Join your temporary voice channel first.', flags: MessageFlags.Ephemeral });
    const customId = isBliPanel ? `vcm:rename::${channelId}` : 'vm_modal_rename';
    return interaction.showModal(new ModalBuilder().setCustomId(customId).setTitle('Rename voice channel').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New channel name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true))));
  }

  if (['permit', 'reject', 'transfer', 'disconnect'].includes(action)) {
    if (!channelId) return interaction.reply({ content: 'Join your temporary voice channel first.', flags: MessageFlags.Ephemeral });
    const prompt = { permit: '✅ Who do you want to **permit**?', reject: '🚫 Who do you want to **reject**?', transfer: '🔄 Who do you want to **transfer** ownership to?', disconnect: '🔨 Who do you want to **disconnect**?' }[action];
    const customId = isBliPanel
      ? `vc:do_${action}::${channelId}`
      : `vm_select:${action}`;
    return interaction.reply({ content: isBliPanel ? prompt : 'Select a member:', components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder('Select a member'))], flags: MessageFlags.Ephemeral });
  }

  if (action === 'limit_up' || action === 'limit_down') {
    if (!channelId) return interaction.reply({ content: 'Join your temporary voice channel first.', flags: MessageFlags.Ephemeral });
    const temp = await voiceDb.getTemp(channelId);
    if (!temp) return interaction.reply({ content: 'Join your temporary voice channel first.', flags: MessageFlags.Ephemeral });
    const next = Math.max(0, Math.min(99, (temp.user_limit || 0) + (action === 'limit_up' ? 1 : -1)));
    return voiceMaster.executeAction(interaction, 'limit', { limit: next, channelId });
  }

  if (action === 'info') {
    const temp = channelId ? await voiceDb.getTemp(channelId) : null;
    return interaction.reply({ content: temp ? `Owner: <@${temp.owner_id}>\nLimit: ${temp.user_limit || 'unlimited'}\nLocked: ${temp.is_locked ? 'yes' : 'no'}\nHidden: ${temp.is_ghosted ? 'yes' : 'no'}` : 'You are not in a managed temporary channel.', flags: MessageFlags.Ephemeral });
  }

  return voiceMaster.executeAction(interaction, action, { channelId });
}

async function handleModal(interaction) {
  if (interaction.customId !== 'vm_modal_rename' && !interaction.customId.startsWith('vcm:rename::')) return;
  const channelId = interaction.customId.startsWith('vcm:rename::')
    ? interaction.customId.slice('vcm:rename::'.length) || undefined
    : undefined;
  return voiceMaster.executeAction(interaction, 'rename', { name: interaction.fields.getTextInputValue('name'), channelId });
}

async function handleSelect(interaction) {
  if (interaction.customId.startsWith('vm_select:')) {
    return voiceMaster.executeAction(interaction, interaction.customId.slice('vm_select:'.length), { userId: interaction.values[0] });
  }

  if (!interaction.customId.startsWith('vc:do_')) return;
  const payload = interaction.customId.slice('vc:do_'.length);
  const [action, channelId] = payload.split('::');
  return voiceMaster.executeAction(interaction, action, { userId: interaction.values[0], channelId: channelId || undefined });
}

module.exports = { handleButton, handleModal, handleSelect };
