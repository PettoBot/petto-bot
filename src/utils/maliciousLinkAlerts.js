const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { defangUrl } = require('./safeBrowsing');
const logger = require('./logger');

const THREAT_LABELS = {
  MALWARE: 'Malware',
  SOCIAL_ENGINEERING: 'Phishing / social engineering',
  UNWANTED_SOFTWARE: 'Unwanted software',
  POTENTIALLY_HARMFUL_APPLICATION: 'Potentially harmful application',
};

async function notifyMaliciousLink(client, { url, threatTypes, reporterId, guild, channel }) {
  const channelId = config.maliciousLinkAlertChannelId;
  if (!client || !channelId) return false;

  const target = await client.channels.fetch(channelId).catch(() => null);
  if (!target?.isTextBased?.() || !target.messages) {
    logger.warn(`Malicious-link alert channel ${channelId} is unavailable.`);
    return false;
  }

  const labels = (threatTypes ?? []).map((type) => THREAT_LABELS[type] ?? type);
  const safeUrl = defangUrl(url).slice(0, 1000);
  const developerIds = (config.developerIds ?? []).slice(0, 25);

  const embed = new EmbedBuilder()
    .setColor(0xfe6465)
    .setTitle('Malicious URL detected')
    .setDescription(`A URL checked with \`!am link\` was flagged and added to Petto's threat database.\n\n\`${safeUrl}\``)
    .addFields(
      { name: 'Threats', value: labels.length ? labels.join(', ').slice(0, 1024) : 'Unknown', inline: false },
      { name: 'Reported by', value: reporterId ? `<@${reporterId}> (\`${reporterId}\`)` : 'Unknown', inline: true },
      { name: 'Server', value: guild ? `${guild.name} (\`${guild.id}\`)`.slice(0, 1024) : 'Unknown', inline: true },
      { name: 'Channel', value: channel ? `<#${channel.id}> (\`${channel.id}\`)` : 'Unknown', inline: true },
    )
    .setTimestamp();

  const mentions = developerIds.map((id) => `<@${id}>`).join(' ');
  const sent = await target.send({
    content: mentions || undefined,
    embeds: [embed],
    allowedMentions: { users: developerIds },
  }).catch((err) => {
    logger.error('Failed to send malicious-link developer alert:', err);
    return null;
  });

  return Boolean(sent);
}

module.exports = { notifyMaliciousLink };
