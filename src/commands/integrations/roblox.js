const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const CACHE_MS = 5 * 60_000;
const COOLDOWN = { name: 'roblox', ms: 3000 };
const NAME_PATTERN = /^[\w]{3,20}$/;
const ID_PATTERN = /^\d{1,15}$/;
const GROUPS_SHOWN = 5;

/** `{ id }` or `{ name }` from a username, a user id or a roblox.com profile link, or null. */
function parseUser(input) {
  const text = String(input ?? '').trim();
  const link = /roblox\.com\/(?:[a-z-]+\/)?users\/(\d{1,15})/i.exec(text);
  if (link) return { id: link[1] };
  if (ID_PATTERN.test(text)) return { id: text };
  if (NAME_PATTERN.test(text)) return { name: text };
  return null;
}

async function idOf(target) {
  if (target.id) return target.id;
  const found = await fetchJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [target.name], excludeBannedUsers: false }),
  });
  const id = found?.data?.[0]?.id;
  if (!id) throw new IntegrationError('notFound');
  return String(id);
}

/** What is known of a user: the profile (required) and the counts, picture and groups (left out when they fail). */
async function findUser(target) {
  const id = await idOf(target);
  return cached(`rbx:${id}`, CACHE_MS, async () => {
    const [profile, friends, followers, picture, groups] = await Promise.all([
      fetchJson(`https://users.roblox.com/v1/users/${id}`),
      fetchJson(`https://friends.roblox.com/v1/users/${id}/friends/count`).catch(() => null),
      fetchJson(`https://friends.roblox.com/v1/users/${id}/followers/count`).catch(() => null),
      fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=420x420&format=Png&isCircular=false`).catch(() => null),
      fetchJson(`https://groups.roblox.com/v2/users/${id}/groups/roles`).catch(() => null),
    ]);
    if (!profile?.id) throw new IntegrationError('notFound');
    const image = picture?.data?.[0];
    return {
      id: String(profile.id),
      name: profile.name,
      displayName: profile.displayName,
      description: profile.description,
      created: profile.created,
      banned: Boolean(profile.isBanned),
      verified: Boolean(profile.hasVerifiedBadge),
      friends: friends?.count ?? null,
      followers: followers?.count ?? null,
      picture: image?.state === 'Completed' ? image.imageUrl : null,
      groups: (groups?.data ?? []).map((entry) => ({ name: entry.group?.name, role: entry.role?.name })).filter((entry) => entry.name),
    };
  });
}

module.exports = {
  aliases: ['rbx'],
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Look up a Roblox profile: friends, followers and groups.')
    .addStringOption((o) => o.setName('user').setDescription('The username, the user id or the link to the profile').setMaxLength(100).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const number = (value) => formatNumber(lang, value);
    await lookup(interaction, lang, 'Roblox', async () => {
      const target = parseUser(interaction.options.getString('user', true));
      if (!target) throw new IntegrationError('badInput');
      const user = await findUser(target);
      const shownName = user.displayName && user.displayName !== user.name ? `${plain(user.displayName, 60)} (@${user.name})` : `@${user.name}`;
      const groups = user.groups.slice(0, GROUPS_SHOWN).map((group) => `${plain(group.name, 60)}${group.role ? ` · ${plain(group.role, 40)}` : ''}`);
      return infoPayload({
        accent: null,
        title: user.verified ? `${shownName} ✔` : shownName,
        subtitle: user.description ? [plain(user.description, 300)] : [],
        thumbnail: user.picture,
        sections: [
          {
            lines: [
              user.friends !== null ? row(t(lang, 'integrations.roblox.friends'), number(user.friends)) : null,
              user.followers !== null ? row(t(lang, 'integrations.roblox.followers'), number(user.followers)) : null,
              row(t(lang, 'integrations.roblox.joined'), dateTag(user.created)),
              user.banned ? `-# ${t(lang, 'integrations.roblox.banned')}` : null,
            ],
          },
          groups.length ? { title: t(lang, 'integrations.roblox.groups', { count: user.groups.length }), lines: groups } : null,
        ].filter(Boolean),
        footer: t(lang, 'info.card.id', { id: user.id }),
        buttons: [{ label: t(lang, 'integrations.roblox.open'), url: `https://www.roblox.com/users/${user.id}/profile` }],
      });
    }, COOLDOWN);
  },
};

module.exports.parseUser = parseUser;
module.exports.findUser = findUser;
