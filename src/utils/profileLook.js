// What Discord shows around a person (the decoration of the avatar, the nameplate and the server tag) as pictures and text, for the
// image cards and `!userinfo`. Each one is empty when the person has none. Only addresses of Discord's own CDN are built, from ids and
// paths that are checked first.
const CDN = 'https://cdn.discordapp.com';
const SAFE_PATH = /^[A-Za-z0-9_\-/]+$/;
function decorationUrl(user) {
  const url = user?.avatarDecorationURL?.();
  // `passthrough=false` is the still picture (the first frame) of a decoration that moves.
  return typeof url === 'string' && url.startsWith(`${CDN}/`) ? `${url}${url.includes('?') ? '&' : '?'}size=256&passthrough=false` : '';
}
/** The same decoration as its animated picture (an APNG), or '' when it does not move. Discord marks those with an `a_` asset. */
function animatedDecorationUrl(user) {
  const asset = user?.avatarDecorationData?.asset;
  return typeof asset === 'string' && asset.startsWith('a_') ? decorationUrl(user).replace('passthrough=false', 'passthrough=true') : '';
}
function nameplateUrl(user) {
  const asset = user?.collectibles?.nameplate?.asset;
  return typeof asset === 'string' && SAFE_PATH.test(asset) ? `${CDN}/assets/collectibles/${asset.replace(/\/?$/, '/')}static.png` : '';
}
function serverTag(user) {
  const guild = user?.primaryGuild;
  return guild?.identityEnabled && typeof guild.tag === 'string' ? guild.tag.slice(0, 4) : '';
}
function serverTagBadge(user) {
  const guild = user?.primaryGuild;
  return guild?.identityEnabled && /^\d{15,25}$/.test(String(guild.identityGuildId)) && /^[a-f0-9]{8,64}$/i.test(String(guild.badge ?? ''))
    ? `${CDN}/guild-tag-badges/${guild.identityGuildId}/${guild.badge}.png?size=64` : '';
}

module.exports = { decorationUrl, animatedDecorationUrl, nameplateUrl, serverTag, serverTagBadge };
