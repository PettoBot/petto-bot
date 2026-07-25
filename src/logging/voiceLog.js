const { sendLog, getAvatar, fetchMod, AuditLogEvent } = require('./engine');

async function handleVoiceState(oldState, newState, client) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guildId = newState.guild?.id ?? oldState.guild?.id;
  if (!guildId) return;

  const guild = newState.guild ?? oldState.guild;
  const avatar = getAvatar(member.user) ?? undefined;
  const ts = new Date().toISOString();
  const footer = { text: `User ID: ${member.id}` };
  const ignoreIds = [member.id];

  if (!oldState.channelId && newState.channelId) {
    return sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: 'Voice Connected', icon_url: avatar },
        description: `<@${member.id}> joined <#${newState.channelId}>`,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.channelId && !newState.channelId) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberDisconnect, member.id);
    const fields = mod ? [{ name: 'Disconnected by', value: mod, inline: true }] : [];
    return sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: 'Voice Disconnected', icon_url: avatar },
        description: `<@${member.id}> left <#${oldState.channelId}>`,
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberMove, member.id);
    const fields = mod ? [{ name: 'Moved by', value: mod, inline: true }] : [];
    return sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: 'Voice Switched', icon_url: avatar },
        description: `<@${member.id}> moved from <#${oldState.channelId}> to <#${newState.channelId}>`,
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  const inChannel = newState.channelId ? ` in <#${newState.channelId}>` : '';

  if (oldState.serverMute !== newState.serverMute) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberUpdate, member.id);
    const fields = mod ? [{ name: newState.serverMute ? 'Muted by' : 'Unmuted by', value: mod, inline: true }] : [];
    await sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: newState.serverMute ? 'Server Muted' : 'Server Unmuted', icon_url: avatar },
        description: `<@${member.id}> was ${newState.serverMute ? 'server muted' : 'server unmuted'}${inChannel}`,
        fields,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    const mod = await fetchMod(guild, AuditLogEvent.MemberUpdate, member.id);
    const fields = mod ? [{ name: newState.serverDeaf ? 'Deafened by' : 'Undeafened by', value: mod, inline: true }] : [];
    await sendLog(
      client,
      guildId,
      'voice',
      {
        author: { name: newState.serverDeaf ? 'Server Deafened' : 'Server Undeafened', icon_url: avatar },
        description: `<@${member.id}> was ${newState.serverDeaf ? 'server deafened' : 'server undeafened'}${inChannel}`,
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
        author: { name: newState.streaming ? 'Stream Started' : 'Stream Ended', icon_url: avatar },
        description: `<@${member.id}> ${newState.streaming ? 'started' : 'stopped'} streaming${inChannel}`,
        footer,
        timestamp: ts,
      },
      { ignoreIds },
    );
  }
}

module.exports = { handleVoiceState };
