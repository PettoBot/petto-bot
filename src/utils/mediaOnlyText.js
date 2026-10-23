// i18n-ignore-file: names of sites (brands) and the shared pieces of the two commands of the media channels.
const { PermissionFlagsBits } = require('discord.js');
const { NETWORK_IDS } = require('./mediaOnly');
const { t } = require('../i18n');

/** The names people know the sites by. */
const NETWORK_NAMES = Object.freeze({
  youtube: 'YouTube', twitter: 'X (Twitter)', instagram: 'Instagram', tiktok: 'TikTok', pinterest: 'Pinterest', spotify: 'Spotify', twitch: 'Twitch',
  kick: 'Kick', soundcloud: 'SoundCloud', reddit: 'Reddit', facebook: 'Facebook', github: 'GitHub', gif: 'GIFs (Tenor, Giphy)', discord: 'Discord',
});

const names = (ids) => ids.map((id) => NETWORK_NAMES[id] ?? id).join(', ');

/** The rule of a channel in one line of text, for the lists. */
function describe(lang, rule) {
  const parts = [];
  if (rule.attachments_enabled) {
    const kinds = [rule.allow_images !== false && t(lang, 'mediaonly.kind.images'), rule.allow_videos && t(lang, 'mediaonly.kind.videos'), rule.allow_audio && t(lang, 'mediaonly.kind.audio'), rule.allow_files && t(lang, 'mediaonly.kind.files')].filter(Boolean);
    parts.push(t(lang, 'mediaonly.describe.attachments', { kinds: kinds.join(', ') }));
  }
  if (rule.links_enabled) {
    parts.push(rule.networks?.length ? t(lang, 'mediaonly.describe.linksOf', { sites: names(rule.networks) }) : t(lang, 'mediaonly.describe.linksAny'));
  }
  parts.push(t(lang, rule.allow_caption ? 'mediaonly.describe.caption' : 'mediaonly.describe.noCaption'));
  return parts.join(' · ');
}

/** Checks that the bot can delete in the channel, or returns the answer to give. */
function botCanModerate(interaction, channel) {
  const perms = channel.permissionsFor?.(interaction.guild.members.me);
  return !!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages]);
}

module.exports = { NETWORK_NAMES, NETWORK_IDS, names, describe, botCanModerate };
