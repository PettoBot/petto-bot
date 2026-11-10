// i18n-ignore-file: the card of a post is written once, in English, in the public channel of the Petto server (the posts and the titles are the ones people wrote)
// How a post of the board looks in Discord: a Components V2 card with the title, the text, who wrote it and where it stands, and a row of
// buttons: Like and Dislike (they are the votes, the same ones as on the website) and links to the post and its comments.
// The icons are the colorless set of Petto, so the card stays calm and the colors only come from the side bar.
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// The emojis of the board (the Petto server).
const EMOJI = {
  like: { id: '1464274175110942740', name: 'like' },
  dislike: { id: '1464274177996357653', name: 'dislike' },
  author: '<:suggeuser:1464283727386640585>',
  comments: { id: '1450677529118642372', name: 'pe_notas' },
  // The link icon of Petto's flat grey set (`pe_Link`, EMOJI.LINK): the blue arrow the old `feed` bot used (`41`) is of the glossy set that was taken out.
  open: { id: '1566302127381282829', name: 'pe_Link' },
  kind: {
    idea: '<:pe_ticket_claim:1562517641703456868>',
    feedback: '<:pe_razon:1450677650933940347>',
    bug: '<:pe_mod:1533209776862003313>',
  },
  status: {
    open: '<:pe_ticket_reopen:1562518213278044182>',
    planned: '<:pe_calendario:1450677526752923649>',
    in_progress: '<:39:1529270171573682266>',
    done: '<:38:1529270147464954097>',
    declined: '<:40:1529270174086336747>',
  },
};

const KIND_LABEL = { idea: 'Idea', feedback: 'Feedback', bug: 'Bug' };
const STATUS_LABEL = { open: 'Open', planned: 'Planned', in_progress: 'In progress', done: 'Done', declined: 'Declined' };
const TAG_LABEL = { commands: 'Commands', moderation: 'Moderation', logging: 'Logging', dashboard: 'Dashboard', website: 'Website', quests: 'Quests', embeds: 'Embeds', premium: 'Premium', other: 'Other' };

/** Text that comes from a person, made safe to show: no mentions of everyone, roles or users, and no way to close a block of the layout. */
function safe(text, max) {
  const value = String(text ?? '').replace(/\r\n/g, '\n').replace(/@(everyone|here)/gi, '@​$1').replace(/<@([!&]?)(\d+)>/g, '<​@$1$2>').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

const postUrl = (site, post) => `${String(site).replace(/\/+$/, '')}/feedback/${post.id}`;

/** The `custom_id` of a vote button. It carries the post, so a vote still finds its post after a restart. */
const VOTE_PREFIX = 'fb';
const voteId = (direction, postId) => `${VOTE_PREFIX}:${direction}:${postId}`;
/** `{ postId, value }` of a vote button (1 for Like, -1 for Dislike), or null when the id is not one of ours. */
function parseVoteId(customId) {
  const match = /^fb:(up|down):(\d{1,12})$/.exec(String(customId ?? ''));
  return match ? { postId: Number(match[2]), value: match[1] === 'up' ? 1 : -1 } : null;
}

/** The message of a post, in the shape the Discord API takes (to send and to edit). */
function buildPost(post, site) {
  const tags = (post.tags ?? []).map((tag) => TAG_LABEL[tag] ?? tag).filter(Boolean);
  const status = post.status ?? 'open';
  const head = `-# ${EMOJI.kind[post.kind] ?? ''} ${KIND_LABEL[post.kind] ?? 'Post'}  ·  #${post.id}  ·  ${EMOJI.status[status] ?? ''} ${STATUS_LABEL[status] ?? status}`;
  // No accent color: the card is as plain as the other cards in the chat.
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${head}\n### ${safe(post.title, 120)}`));
  const body = safe(post.body, 900);
  if (body) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const note = safe(post.status_note, 300);
  const meta = [`${EMOJI.author} ${safe(post.username, 40) || 'Someone'}`, tags.length ? tags.join(' · ') : ''].filter(Boolean).join('   ·   ');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${meta}${note ? `\n> ${note.replace(/\n/g, '\n> ')}` : ''}`));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Vote with the buttons. It counts on petto.sbs/feedback too.'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(voteId('up', post.id)).setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.like).setLabel(String(post.votes_up ?? 0)),
    new ButtonBuilder().setCustomId(voteId('down', post.id)).setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.dislike).setLabel(String(post.votes_down ?? 0)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setEmoji(EMOJI.comments).setLabel(`Comments (${post.comments_count ?? 0})`).setURL(`${postUrl(site, post)}#comments`),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setEmoji(EMOJI.open).setLabel('Open').setURL(postUrl(site, post)),
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container.toJSON(), row.toJSON()], allowed_mentions: { parse: [] } };
}

module.exports = { EMOJI, VOTE_PREFIX, safe, postUrl, voteId, parseVoteId, buildPost, KIND_LABEL, STATUS_LABEL };
