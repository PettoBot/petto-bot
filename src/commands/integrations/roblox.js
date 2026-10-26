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


/** `{ id }` or `{ name }` from a group id, a roblox.com/groups link or a name. */
function parseGroup(input) {
  const text = String(input ?? '').trim();
  const link = /roblox\.com\/(?:[a-z-]+\/)?(?:groups|communities)\/(\d{1,15})/i.exec(text);
  if (link) return { id: link[1] };
  if (/^\d{1,15}$/.test(text)) return { id: text };
  return text.length >= 3 && text.length <= 50 ? { name: text } : null;
}

/** The card of a group: its members, owner and description. */
async function groupCard(input, lang) {
  const target = parseGroup(input);
  if (!target) throw new IntegrationError('badInput');
  let id = target.id;
  if (!id) {
    const found = await cached(`rbx:gsearch:${target.name.toLowerCase()}`, CACHE_MS, () => fetchJson(`https://groups.roblox.com/v1/groups/search?keyword=${encodeURIComponent(target.name)}&prioritizeExactMatch=true&limit=10`));
    id = found?.data?.[0]?.id;
    if (!id) throw new IntegrationError('notFound');
  }
  const group = await cached(`rbx:group:${id}`, CACHE_MS, () => fetchJson(`https://groups.roblox.com/v1/groups/${id}`));
  if (!group?.id) throw new IntegrationError('notFound');
  const icon = await cached(`rbx:gicon:${id}`, CACHE_MS, () => fetchJson(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${id}&size=420x420&format=Png&isCircular=false`).catch(() => null));
  const picture = icon?.data?.[0]?.state === 'Completed' ? icon.data[0].imageUrl : null;
  return infoPayload({
    accent: null,
    title: group.hasVerifiedBadge ? `${plain(group.name, 100)} ✔` : plain(group.name, 100),
    subtitle: group.description ? [plain(group.description, 300)] : [],
    thumbnail: picture,
    sections: [{
      lines: [
        row(t(lang, 'integrations.roblox.members'), formatNumber(lang, group.memberCount ?? 0)),
        group.owner?.username ? row(t(lang, 'integrations.roblox.owner'), `@${plain(group.owner.username, 40)}`) : null,
        row(t(lang, 'integrations.roblox.entry'), t(lang, group.publicEntryAllowed ? 'integrations.roblox.entryAnyone' : 'integrations.roblox.entryApproval')),
        group.shout?.body ? row(t(lang, 'integrations.roblox.shout'), plain(group.shout.body, 200)) : null,
      ],
    }],
    footer: t(lang, 'info.card.id', { id: group.id }),
    buttons: [{ label: t(lang, 'integrations.roblox.openGroup'), url: `https://www.roblox.com/communities/${group.id}` }],
  });
}

module.exports = {
  aliases: ['rbx'],
  data: new SlashCommandBuilder()
    .setName('roblox')
    .setDescription('Look up a Roblox profile, avatar or group.')
    .addSubcommand((s) => s
      .setName('user')
      .setDescription('A profile: friends, followers and groups.')
      .addStringOption((o) => o.setName('user').setDescription('The username, the user id or the link to the profile').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('avatar')
      .setDescription('The avatar of a Roblox user, full body.')
      .addStringOption((o) => o.setName('user').setDescription('The username, the user id or the link to the profile').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('group')
      .setDescription('A Roblox group: members, owner and description.')
      .addStringOption((o) => o.setName('group').setDescription('The name, the id or the link of the group').setMaxLength(100).setRequired(true))),

  // `!rbx Builderman` is the user.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'user' : null),
  prefixSubcommandAliases: { profile: 'user', u: 'user', body: 'avatar', skin: 'avatar', g: 'group', clan: 'group' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const number = (value) => formatNumber(lang, value);
    const sub = interaction.options.getSubcommand();
    await lookup(interaction, lang, 'Roblox', async () => {
      if (sub === 'group') return groupCard(interaction.options.getString('group', true), lang);
      const target = parseUser(interaction.options.getString('user', true));
      if (!target) throw new IntegrationError('badInput');
      const user = await findUser(target);
      if (sub === 'avatar') {
        const body = await cached(`rbx:full:${user.id}`, CACHE_MS, () => fetchJson(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${user.id}&size=420x420&format=Png&isCircular=false`));
        const image = body?.data?.[0];
        if (image?.state !== 'Completed' || !image.imageUrl) throw new IntegrationError('unavailable');
        return infoPayload({
          accent: null,
          title: user.displayName && user.displayName !== user.name ? `${plain(user.displayName, 60)} (@${user.name})` : `@${user.name}`,
          banner: image.imageUrl,
          footer: t(lang, 'info.card.id', { id: user.id }),
          buttons: [{ label: t(lang, 'integrations.roblox.open'), url: `https://www.roblox.com/users/${user.id}/profile` }],
        });
      }
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
module.exports.parseGroup = parseGroup;
module.exports.findUser = findUser;
