const { sendLog, getAvatar, fetchMod, AuditLogEvent } = require('./engine');
const { t, guildLanguage } = require('../i18n');

async function handleVoiceState(oldState, newState, client) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId) return;

  const guild = newState.guild ?? oldState.guild;
  const lang = await guildLanguage(guildId);
  const avatar = getAvatar(member.user) ?? undefined;
  const ts = new Date().toISOString();
  const footer = { text: t(lang, 'logs.footer.user', { id: member.id }) };
  const ignoreIds = [member.id];

  if (!oldState.channelId && newState.channelId) {
    return sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: t(lang, 'logs.voice.joined.title'), icon_url: avatar },
        description: t(lang, 'logs.voice.joined.description', { member: `<@${member.id}>`, channel: `<#${newState.channelId}>` }),
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.channelId && !newState.channelId) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberDisconnect, member.id);
    const fields = mod ? [{ name: t(lang, 'logs.voice.disconnectedBy'), value: mod, inline: true }] : [];
    return sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: t(lang, 'logs.voice.left.title'), icon_url: avatar },
        description: t(lang, 'logs.voice.left.description', { member: `<@${member.id}>`, channel: `<#${oldState.channelId}>` }),
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberMove, member.id);
    const fields = mod ? [{ name: t(lang, 'logs.voice.movedBy'), value: mod, inline: true }] : [];
    return sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: t(lang, 'logs.voice.switched.title'), icon_url: avatar },
        description: t(lang, 'logs.voice.switched.description', { member: `<@${member.id}>`, from: `<#${oldState.channelId}>`, to: `<#${newState.channelId}>` }),
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  // The same sentence with or without the channel the member is in.
  const describe = (what) => (newState.channelId
    ? t(lang, `logs.voice.${what}.descriptionIn`, { member: `<@${member.id}>`, channel: `<#${newState.channelId}>` })
    : t(lang, `logs.voice.${what}.description`, { member: `<@${member.id}>` }));

  if (oldState.serverMute !== newState.serverMute) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberUpdate, member.id);
    const fields = mod ? [{ name: t(lang, newState.serverMute ? 'logs.voice.mutedBy' : 'logs.voice.unmutedBy'), value: mod, inline: true }] : [];
    await sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: t(lang, newState.serverMute ? 'logs.voice.muted.title' : 'logs.voice.unmuted.title'), icon_url: avatar },
        description: describe(newState.serverMute ? 'muted' : 'unmuted'),
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberUpdate, member.id);
    const fields = mod ? [{ name: t(lang, newState.serverDeaf ? 'logs.voice.deafenedBy' : 'logs.voice.undeafenedBy'), value: mod, inline: true }] : [];
    await sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: t(lang, newState.serverDeaf ? 'logs.voice.deafened.title' : 'logs.voice.undeafened.title'), icon_url: avatar },
        description: describe(newState.serverDeaf ? 'deafened' : 'undeafened'),
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.streaming !== newState.streaming) {
    await sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: t(lang, newState.streaming ? 'logs.voice.streamStarted.title' : 'logs.voice.streamEnded.title'), icon_url: avatar },
        description: describe(newState.streaming ? 'streamStarted' : 'streamEnded'),
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }
}

module.exports = { handleVoiceState };
