// i18n-ignore-file: the list of sites and the rules of the media channels, not text for people.
// Media channels: a channel where only pictures, videos or links (of the sites the server chose) can be posted. This file holds the rules
// (pure functions, no Discord calls) so the command, the event and the dashboard's list of sites agree on them.

/** The sites a link channel can allow. `domains` match the host and its subdomains; `test` is for a site with many addresses. */
const NETWORKS = Object.freeze({
  youtube: { domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  twitter: { domains: ['x.com', 'twitter.com', 't.co', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'] },
  instagram: { domains: ['instagram.com', 'instagr.am', 'ddinstagram.com'] },
  tiktok: { domains: ['tiktok.com'] },
  pinterest: { domains: ['pin.it'], test: (host) => /(^|\.)pinterest\.[a-z.]{2,}$/.test(host) },
  spotify: { domains: ['spotify.com', 'spotify.link'] },
  twitch: { domains: ['twitch.tv'] },
  kick: { domains: ['kick.com'] },
  soundcloud: { domains: ['soundcloud.com'] },
  reddit: { domains: ['reddit.com', 'redd.it'] },
  facebook: { domains: ['facebook.com', 'fb.watch', 'fb.com'] },
  github: { domains: ['github.com'] },
  gif: { domains: ['tenor.com', 'giphy.com'] },
  discord: { domains: ['discord.com', 'discord.gg', 'discordapp.com'] },
});
const NETWORK_IDS = Object.freeze(Object.keys(NETWORKS));

/** What people type for a site → its id (`x` and `yt` are accepted). */
const ALIASES = { x: 'twitter', yt: 'youtube', ig: 'instagram', insta: 'instagram', tt: 'tiktok', pin: 'pinterest', fb: 'facebook', gifs: 'gif', tenor: 'gif', giphy: 'gif' };

/** `"YouTube, x ig"` → `['youtube', 'twitter', 'instagram']`; `null` when a name is not a known site. `any`/`all` or nothing → `[]` (every link). */
function parseNetworks(text) {
  const words = String(text ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const word of words) {
    if (word === 'any' || word === 'all' || word === 'todos' || word === 'cualquiera') return [];
    const id = NETWORKS[word] ? word : ALIASES[word];
    if (!id) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The id of the site a host belongs to, or `other`. */
function networkOf(host) {
  const h = String(host ?? '').toLowerCase().replace(/^www\./, '');
  for (const [id, net] of Object.entries(NETWORKS)) {
    if (net.test?.(h)) return id;
    if (net.domains.some((d) => h === d || h.endsWith(`.${d}`))) return id;
  }
  return 'other';
}

const URL_RE = /<?https?:\/\/[^\s<>]+>?/gi;

/** The links of a text: `{ url, host }` for each (a link in `<...>` counts too). */
function linksOf(content) {
  const out = [];
  for (const raw of String(content ?? '').match(URL_RE) ?? []) {
    const url = raw.replace(/^<|>$/g, '').replace(/[)\].,;:!?]+$/, '');
    try { out.push({ raw, url, host: new URL(url).hostname }); } catch { /* not a link */ }
  }
  return out;
}

const EXT = {
  image: /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|svg|tiff?)$/i,
  video: /\.(mp4|mov|webm|mkv|avi|m4v|3gp)$/i,
  audio: /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i,
};

/** `image`, `video`, `audio` or `file` for an attachment (by its type, then by the end of its name). */
function attachmentKind(attachment) {
  const type = String(attachment?.contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const name = String(attachment?.name ?? attachment?.filename ?? '');
  for (const [kind, re] of Object.entries(EXT)) if (re.test(name)) return kind;
  return 'file';
}

/**
 * Whether a message fits a channel's rule. The rule: `attachments_enabled`, `links_enabled`, `allow_images`, `allow_videos`, `allow_audio`,
 * `allow_files`, `networks` (empty = any site), `allow_caption` (text next to the media). A message needs at least one allowed attachment or
 * allowed link, and nothing that is not allowed.
 * @param {{ content?: string, attachments?: { contentType?: string, name?: string }[] }} message
 * @returns {{ ok: true } | { ok: false, reason: 'empty_attach' | 'empty_link' | 'empty_both' | 'kind' | 'network' | 'caption' }}
 */
function evaluate(message, rule) {
  const attachments = [...(message.attachments ?? [])];
  const links = linksOf(message.content);
  const kindAllowed = { image: rule.allow_images !== false, video: !!rule.allow_videos, audio: !!rule.allow_audio, file: !!rule.allow_files };
  const nets = Array.isArray(rule.networks) ? rule.networks : [];
  const linkAllowed = (link) => !nets.length || nets.includes(networkOf(link.host));

  let validAttachments = 0;
  if (attachments.length) {
    if (!rule.attachments_enabled || !attachments.every((a) => kindAllowed[attachmentKind(a)])) return { ok: false, reason: rule.attachments_enabled ? 'kind' : 'empty_link' };
    validAttachments = attachments.length;
  }
  let validLinks = 0;
  let text = String(message.content ?? '');
  if (rule.links_enabled && links.length) {
    if (!links.every(linkAllowed)) return { ok: false, reason: 'network' };
    validLinks = links.length;
    for (const link of links) text = text.replace(link.raw, ' ');
  }
  if (!validAttachments && !validLinks) {
    return { ok: false, reason: rule.attachments_enabled && rule.links_enabled ? 'empty_both' : rule.links_enabled ? 'empty_link' : 'empty_attach' };
  }
  if (!rule.allow_caption && text.replace(/\s+/g, '').length) return { ok: false, reason: 'caption' };
  return { ok: true };
}

module.exports = { NETWORKS, NETWORK_IDS, parseNetworks, networkOf, linksOf, attachmentKind, evaluate };
