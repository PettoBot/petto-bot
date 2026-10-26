const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row } = require('../../utils/integrations');
const { t, languageOf } = require('../../i18n');

const PROFILE_URL = 'https://api.mojang.com/users/profiles/minecraft/';
const SESSION_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';
// The pictures are drawn by mc-heads.net from the UUID (Mojang only gives the flat skin file).
const RENDER_URL = 'https://mc-heads.net';
const NAMEMC_URL = 'https://namemc.com/profile/';
const CACHE_MS = 5 * 60_000;
const COOLDOWN = { name: 'minecraft', ms: 3000 };

const NAME_PATTERN = /^\w{1,16}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** `{ kind: 'name' | 'uuid', value }` for what was typed, or null when it is neither a player name nor a UUID. */
function parsePlayer(input) {
  const text = String(input ?? '').trim();
  if (UUID_PATTERN.test(text)) return { kind: 'uuid', value: text.replace(/-/g, '').toLowerCase() };
  if (NAME_PATTERN.test(text)) return { kind: 'name', value: text };
  return null;
}

const dashed = (id) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

/** The skin and cape of a profile from the session server: { skinUrl, slim, capeUrl }. */
function texturesOf(profile) {
  const property = (profile?.properties ?? []).find((entry) => entry.name === 'textures');
  if (!property?.value) return { skinUrl: null, slim: false, capeUrl: null };
  try {
    const { textures = {} } = JSON.parse(Buffer.from(property.value, 'base64').toString('utf8'));
    const https = (url) => (url ? String(url).replace(/^http:/, 'https:') : null); // the session server still answers with http
    return { skinUrl: https(textures.SKIN?.url), slim: textures.SKIN?.metadata?.model === 'slim', capeUrl: https(textures.CAPE?.url) };
  } catch {
    return { skinUrl: null, slim: false, capeUrl: null };
  }
}

/** The player with its skin: { id, name, skinUrl, slim, capeUrl }. */
async function findPlayer(input) {
  const parsed = parsePlayer(input);
  if (!parsed) throw new IntegrationError('badInput');
  return cached(`mc:${parsed.value.toLowerCase()}`, CACHE_MS, async () => {
    let id = parsed.value;
    if (parsed.kind === 'name') {
      const found = await fetchJson(`${PROFILE_URL}${encodeURIComponent(parsed.value)}`, { ok404: true });
      if (!found?.id) throw new IntegrationError('notFound');
      id = found.id;
    }
    const profile = await fetchJson(`${SESSION_URL}${id}`);
    if (!profile?.id) throw new IntegrationError('notFound');
    return { id: profile.id, name: profile.name, ...texturesOf(profile) };
  });
}

module.exports = {
  aliases: ['mc'],
  data: new SlashCommandBuilder()
    .setName('minecraft')
    .setDescription('Look up a Minecraft Java player: skin, head and UUID.')
    .addSubcommand((s) => s
      .setName('user')
      .setDescription('The UUID, skin and cape of a Minecraft Java player.')
      .addStringOption((o) => o.setName('player').setDescription('The name or the UUID of the player').setMaxLength(36).setRequired(true)))
    .addSubcommand((s) => s
      .setName('skin')
      .setDescription('The skin of a Minecraft Java player, full body, with a link to download it.')
      .addStringOption((o) => o.setName('player').setDescription('The name or the UUID of the player').setMaxLength(36).setRequired(true)))
    .addSubcommand((s) => s
      .setName('head')
      .setDescription('The head of a Minecraft Java player, big.')
      .addStringOption((o) => o.setName('player').setDescription('The name or the UUID of the player').setMaxLength(36).setRequired(true))),

  // The short words people type after the command.
  // `!mc Notch` is `!mc user Notch`.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'user' : null),
  prefixSubcommandAliases: { profile: 'user', uuid: 'user', avatar: 'head', body: 'skin' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const input = interaction.options.getString('player', true);
    await lookup(interaction, lang, 'Minecraft', async () => {
      const player = await findPlayer(input);
      const buttons = [{ label: t(lang, 'integrations.minecraft.namemc'), url: `${NAMEMC_URL}${player.id}` }];
      if (player.skinUrl) buttons.unshift({ label: t(lang, 'integrations.minecraft.download'), url: player.skinUrl });
      const model = t(lang, player.slim ? 'integrations.minecraft.slim' : 'integrations.minecraft.classic');

      if (sub === 'skin') {
        return infoPayload({
          accent: null,
          title: player.name,
          banner: `${RENDER_URL}/body/${player.id}/right`,
          sections: [{ lines: [row(t(lang, 'integrations.minecraft.model'), model)] }],
          footer: t(lang, 'integrations.minecraft.footer'),
          buttons,
        });
      }
      if (sub === 'head') {
        return infoPayload({
          accent: null,
          title: player.name,
          banner: `${RENDER_URL}/head/${player.id}`,
          footer: t(lang, 'integrations.minecraft.footer'),
          buttons,
        });
      }
      return infoPayload({
        accent: null,
        title: player.name,
        thumbnail: `${RENDER_URL}/avatar/${player.id}/128`,
        sections: [{
          lines: [
            row(t(lang, 'integrations.minecraft.uuid'), `\`${dashed(player.id)}\``),
            row(t(lang, 'integrations.minecraft.model'), model),
            row(t(lang, 'integrations.minecraft.cape'), t(lang, player.capeUrl ? 'info.card.yes' : 'info.card.no')),
          ],
        }],
        footer: t(lang, 'integrations.minecraft.footer'),
        buttons,
      });
    }, COOLDOWN);
  },
};

module.exports.parsePlayer = parsePlayer;
module.exports.texturesOf = texturesOf;
module.exports.findPlayer = findPlayer;
