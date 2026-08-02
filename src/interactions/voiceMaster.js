const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, MessageFlags } = require('discord.js');
const voiceDb = require('../db/voiceMaster');
const voiceMaster = require('../commands/automation/voicemaster');

async function handleButton(interaction) {
  const action = interaction.customId.slice('vm:'.length);
  if (action === 'rename') {
    return interaction.showModal(new ModalBuilder().setCustomId('vm_modal_rename').setTitle('Rename voice channel').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('New channel name').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true))));
  }
  if (['permit', 'reject', 'transfer'].includes(action)) {
    return interaction.reply({ content: 'Select a member:', components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`vm_select:${action}`).setPlaceholder('Select a member'))], flags: MessageFlags.Ephemeral });
  }
  if (action === 'limit_up' || action === 'limit_down') {
    const temp = await voiceDb.getTemp(interaction.member.voice?.channelId);
    if (!temp) return interaction.reply({ content: 'Join your temporary voice channel first.', flags: MessageFlags.Ephemeral });
    const next = Math.max(0, Math.min(99, (temp.user_limit || 0) + (action === 'limit_up' ? 1 : -1)));
    return voiceMaster.executeAction(interaction, 'limit', { limit: next });
  }
  if (action === 'info') {
    const temp = await voiceDb.getTemp(interaction.member.voice?.channelId);
    return interaction.reply({ content: temp ? `Owner: <@${temp.owner_id}>\nLimit: ${temp.user_limit || 'unlimited'}\nLocked: ${temp.is_locked ? 'yes' : 'no'}\nHidden: ${temp.is_ghosted ? 'yes' : 'no'}` : 'You are not in a managed temporary channel.', flags: MessageFlags.Ephemeral });
  }
  return voiceMaster.executeAction(interaction, action);
}

async function handleModal(interaction) {
  if (interaction.customId !== 'vm_modal_rename') return;
  return voiceMaster.executeAction(interaction, 'rename', { name: interaction.fields.getTextInputValue('name') });
}

async function handleSelect(interaction) {
  if (!interaction.customId.startsWith('vm_select:')) return;
  return voiceMaster.executeAction(interaction, interaction.customId.slice('vm_select:'.length), { userId: interaction.values[0] });
}

module.exports = { handleButton, handleModal, handleSelect };
