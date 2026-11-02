// Bluesky: the posts of an account, from the public API (no login, no key). Replies and reposts are left out.
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const API = 'https://public.api.bsky.app/xrpc';
const HANDLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** The handle from `@name.bsky.social`, a link to the profile, or a custom domain. */
function parseActor(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?bsky\.app\/profile\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
  if (HANDLE.test(text) || /^did:plc:[a-z2-7]{24}$/.test(text)) return text;
  return /^[a-z0-9-]{3,}$/.test(text) ? `${text}.bsky.social` : null;
}

async function resolveActor(input) {
  const actor = parseActor(input);
  if (!actor) throw new IntegrationError('badInput');
  const profile = await fetchJsonBody(`${API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  return { id: profile.did, handle: profile.handle, name: profile.displayName || profile.handle, avatar: profile.avatar ?? null, url: `https://bsky.app/profile/${profile.handle}`, posts: profile.postsCount ?? null };
}

/** The newest posts of an account (its own, no replies, no reposts), newest first. */
async function fetchPosts(did, limit = 20) {
  const body = await fetchJsonBody(`${API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&limit=${limit}&filter=posts_no_replies`);
  return (body?.feed ?? [])
    .filter((entry) => !entry.reason && entry.post?.author?.did === did)
    .map((entry) => {
      const post = entry.post;
      const embed = post.embed ?? {};
      const picture = embed.images?.[0]?.fullsize ?? embed.external?.thumb ?? embed.media?.images?.[0]?.fullsize ?? null;
      return {
        id: post.uri, rkey: post.uri.split('/').pop(), text: post.record?.text ?? '', handle: post.author.handle, name: post.author.displayName || post.author.handle,
        avatar: post.author.avatar ?? null, image: picture, published: Date.parse(post.record?.createdAt ?? post.indexedAt) || null, likes: post.likeCount ?? 0,
        link: embed.external?.uri ?? null,
      };
    });
}

/** The card item of a post: its words are the description, and the title is who wrote it. */
function toItem(post) {
  return {
    platform: 'bluesky', type: 'post', id: post.id, title: post.name, url: `https://bsky.app/profile/${post.handle}/post/${post.rkey}`, description: post.text,
    image: post.image, avatar: post.avatar, author: `@${post.handle}`, authorUrl: `https://bsky.app/profile/${post.handle}`, publishedAt: post.published,
  };
}

module.exports = { parseActor, resolveActor, fetchPosts, toItem };
